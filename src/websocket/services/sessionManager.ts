import { Socket, Server as SocketIOServer } from 'socket.io';
import jwt, { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { config } from '@/config/environment';
import { createRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';
import { enhancedAuth } from '../middleware/authEnhanced';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '../types/events';

const redis = createRedisClient();

interface SessionInfo {
  sessionId: string;
  userId: string;
  socketId: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  classIds: string[];
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
}

interface TokenRefreshData {
  refreshToken: string;
  socketId?: string;
}

interface SessionStats {
  totalActiveSessions: number;
  sessionsByRole: Record<string, number>;
  averageSessionDuration: number;
  expiringSoon: number;
}

export class WebSocketSessionManager {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private sessions: Map<string, SessionInfo> = new Map(); // sessionId -> SessionInfo
  private userSessions: Map<string, Set<string>> = new Map(); // userId -> Set of sessionIds
  private cleanupInterval: NodeJS.Timeout;

  constructor(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.io = io;
    
    // Initialize cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 300000);

    // Setup token refresh handlers
    this.setupTokenRefreshHandlers();

    logger.info('WebSocket Session Manager initialized');
  }

  /**
   * Create a new session for a socket connection
   */
  public createSession(socket: Socket): string | null {
    const socketData = socket.data as SocketData;
    if (!socketData) {
      logger.error('Cannot create session - no socket data');
      return null;
    }

    const sessionId = this.generateSessionId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const sessionInfo: SessionInfo = {
      sessionId,
      userId: socketData.userId,
      socketId: socket.id,
      role: socketData.userRole,
      classIds: socketData.classIds,
      createdAt: now,
      lastActivity: now,
      expiresAt,
      ipAddress: socketData.ipAddress || 'unknown',
      userAgent: socketData.userAgent || 'unknown',
      isActive: true,
    };

    // Store session
    this.sessions.set(sessionId, sessionInfo);
    
    // Track user sessions
    if (!this.userSessions.has(socketData.userId)) {
      this.userSessions.set(socketData.userId, new Set());
    }
    this.userSessions.get(socketData.userId)!.add(sessionId);

    // Store in Redis for persistence
    this.storeSessionInRedis(sessionInfo);

    logger.info('WebSocket session created', {
      sessionId,
      userId: socketData.userId,
      socketId: socket.id,
      role: socketData.userRole,
    });

    return sessionId;
  }

  /**
   * Update session activity
   */
  public updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
      this.storeSessionInRedis(session);
    }
  }

  /**
   * Get session information
   */
  public getSession(sessionId: string): SessionInfo | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get all sessions for a user
   */
  public getUserSessions(userId: string): SessionInfo[] {
    const userSessionIds = this.userSessions.get(userId);
    if (!userSessionIds) return [];

    return Array.from(userSessionIds)
      .map(sessionId => this.sessions.get(sessionId))
      .filter((session): session is SessionInfo => session !== undefined && session.isActive);
  }

  /**
   * Invalidate a specific session
   */
  public async invalidateSession(sessionId: string, reason: string = 'manual'): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Mark session as inactive
    session.isActive = false;
    
    // Remove from tracking
    this.sessions.delete(sessionId);
    const userSessions = this.userSessions.get(session.userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    // Remove from Redis
    await this.removeSessionFromRedis(sessionId);

    // Disconnect the socket if still connected
    const socket = this.io.sockets.sockets.get(session.socketId);
    if (socket) {
      socket.emit('auth:error', {
        reason: 'insufficient_permissions', // Use valid reason
        message: `Session invalidated: ${reason}`,
        timestamp: new Date(),
      });
      
      socket.disconnect(true);
    }

    logger.info('WebSocket session invalidated', {
      sessionId,
      userId: session.userId,
      reason,
    });

    return true;
  }

  /**
   * Invalidate all sessions for a user
   */
  public async invalidateUserSessions(userId: string, reason: string = 'manual'): Promise<number> {
    const sessions = this.getUserSessions(userId);
    let invalidatedCount = 0;

    for (const session of sessions) {
      const success = await this.invalidateSession(session.sessionId, reason);
      if (success) invalidatedCount++;
    }

    logger.info('User sessions invalidated', {
      userId,
      invalidatedCount,
      reason,
    });

    return invalidatedCount;
  }

  /**
   * Handle socket disconnection
   */
  public handleDisconnection(socket: Socket): void {
    const socketData = socket.data as SocketData;
    if (!socketData) return;

    // Find session by socket ID
    const session = Array.from(this.sessions.values())
      .find(s => s.socketId === socket.id);

    if (session) {
      // Don't immediately invalidate - allow reconnection
      session.lastActivity = new Date();
      this.storeSessionInRedis(session);
      
      logger.debug('Socket disconnected, session preserved', {
        sessionId: session.sessionId,
        userId: session.userId,
      });
    }
  }

  /**
   * Setup token refresh event handlers
   */
  private setupTokenRefreshHandlers(): void {
    this.io.on('connection', (socket) => {
      // Handle token refresh requests
      socket.on('auth:refresh' as any, async (data: TokenRefreshData, callback?: (response: any) => void) => {
        try {
          const result = await this.handleTokenRefresh(socket, data);
          if (callback) callback(result);
        } catch (error) {
          const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Token refresh failed',
          };
          if (callback) callback(errorResponse);
        }
      });

      // Handle session validation requests
      socket.on('auth:validate_session' as any, async (callback?: (response: any) => void) => {
        try {
          const result = await this.validateSocketSession(socket);
          if (callback) callback(result);
        } catch (error) {
          const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Session validation failed',
          };
          if (callback) callback(errorResponse);
        }
      });

      // Handle logout requests
      socket.on('auth:logout' as any, async (data: { allDevices?: boolean }, callback?: (response: any) => void) => {
        try {
          const result = await this.handleLogout(socket, data.allDevices || false);
          if (callback) callback(result);
        } catch (error) {
          const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Logout failed',
          };
          if (callback) callback(errorResponse);
        }
      });
    });
  }

  /**
   * Handle token refresh
   */
  private async handleTokenRefresh(socket: Socket, data: TokenRefreshData): Promise<any> {
    const { refreshToken } = data;
    
    if (!refreshToken) {
      throw new Error('Refresh token required');
    }

    try {
      // Verify refresh token (this would typically validate against database/Redis)
      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as any;
      
      // Generate new access token  
      const payload = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
      };
      
      const jwtOptions: SignOptions = {
        expiresIn: config.jwt.expiresIn as StringValue | number,
      };
      
      const newAccessToken = jwt.sign(
        payload,
        config.jwt.secret,
        jwtOptions
      );

      // Update socket authentication
      const socketData = socket.data as SocketData;
      if (socketData) {
        socketData.lastActivity = new Date();
      }

      logger.info('Token refreshed successfully', {
        userId: decoded.id,
        socketId: socket.id,
      });

      return {
        success: true,
        data: {
          accessToken: newAccessToken,
          expiresIn: config.jwt.expiresIn,
        },
      };

    } catch (error) {
      logger.warn('Token refresh failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        socketId: socket.id,
      });

      // Emit auth error for invalid refresh token
      socket.emit('auth:error', {
        reason: 'expired_token',
        message: 'Refresh token is invalid or expired',
        timestamp: new Date(),
      });

      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Validate socket session
   */
  private async validateSocketSession(socket: Socket): Promise<any> {
    const socketData = socket.data as SocketData;
    if (!socketData) {
      throw new Error('No session data found');
    }

    // Find session
    const session = Array.from(this.sessions.values())
      .find(s => s.socketId === socket.id);

    if (!session || !session.isActive) {
      throw new Error('Session not found or inactive');
    }

    // Check if session is expired
    if (new Date() > session.expiresAt) {
      await this.invalidateSession(session.sessionId, 'expired');
      throw new Error('Session expired');
    }

    // Update activity
    this.updateSessionActivity(session.sessionId);

    return {
      success: true,
      data: {
        sessionId: session.sessionId,
        userId: session.userId,
        role: session.role,
        classIds: session.classIds,
        expiresAt: session.expiresAt,
        lastActivity: session.lastActivity,
      },
    };
  }

  /**
   * Handle logout
   */
  private async handleLogout(socket: Socket, allDevices: boolean): Promise<any> {
    const socketData = socket.data as SocketData;
    if (!socketData) {
      throw new Error('No user session found');
    }

    if (allDevices) {
      // Logout from all devices
      const invalidatedCount = await this.invalidateUserSessions(
        socketData.userId, 
        'user_logout_all'
      );
      
      return {
        success: true,
        message: `Logged out from ${invalidatedCount} devices`,
        data: { invalidatedSessions: invalidatedCount },
      };
    } else {
      // Logout from current device only
      const session = Array.from(this.sessions.values())
        .find(s => s.socketId === socket.id);
      
      if (session) {
        await this.invalidateSession(session.sessionId, 'user_logout');
      }
      
      return {
        success: true,
        message: 'Logged out successfully',
      };
    }
  }

  /**
   * Cleanup expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions) {
      // Check if session is expired
      if (now > session.expiresAt || !session.isActive) {
        await this.invalidateSession(sessionId, 'expired');
        cleanedCount++;
      }
      // Check if session is inactive for too long (1 hour)
      else if (now.getTime() - session.lastActivity.getTime() > 3600000) {
        await this.invalidateSession(sessionId, 'inactive');
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Expired sessions cleaned up', {
        cleanedCount,
        remainingSessions: this.sessions.size,
      });
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `ws_session_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Store session in Redis
   */
  private async storeSessionInRedis(session: SessionInfo): Promise<void> {
    try {
      const key = `ws_session:${session.sessionId}`;
      const ttl = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
      
      if (ttl > 0) {
        await redis.setex(key, ttl, JSON.stringify(session));
      }
    } catch (error) {
      logger.warn('Failed to store session in Redis', {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Remove session from Redis
   */
  private async removeSessionFromRedis(sessionId: string): Promise<void> {
    try {
      await redis.del(`ws_session:${sessionId}`);
    } catch (error) {
      logger.warn('Failed to remove session from Redis', {
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get session statistics
   */
  public getSessionStats(): SessionStats {
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.isActive);
    
    const sessionsByRole: Record<string, number> = {};
    let totalDuration = 0;
    let expiringSoon = 0;
    const oneHourFromNow = new Date(Date.now() + 3600000);

    for (const session of activeSessions) {
      // Count by role
      sessionsByRole[session.role] = (sessionsByRole[session.role] || 0) + 1;
      
      // Calculate duration
      totalDuration += Date.now() - session.createdAt.getTime();
      
      // Count expiring soon
      if (session.expiresAt < oneHourFromNow) {
        expiringSoon++;
      }
    }

    return {
      totalActiveSessions: activeSessions.length,
      sessionsByRole,
      averageSessionDuration: activeSessions.length > 0 ? totalDuration / activeSessions.length : 0,
      expiringSoon,
    };
  }

  /**
   * Get detailed session information for monitoring
   */
  public getDetailedSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(s => s.isActive);
  }

  /**
   * Force session cleanup (for admin use)
   */
  public async forceCleanup(): Promise<{ cleaned: number; remaining: number }> {
    const beforeCount = this.sessions.size;
    await this.cleanupExpiredSessions();
    const afterCount = this.sessions.size;
    
    return {
      cleaned: beforeCount - afterCount,
      remaining: afterCount,
    };
  }

  /**
   * Extend session expiration
   */
  public extendSession(sessionId: string, additionalTime: number = 3600000): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) {
      return false;
    }

    session.expiresAt = new Date(session.expiresAt.getTime() + additionalTime);
    this.storeSessionInRedis(session);

    logger.info('Session extended', {
      sessionId,
      newExpiresAt: session.expiresAt,
      additionalTime,
    });

    return true;
  }

  /**
   * Destroy session manager
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Invalidate all sessions
    const sessionIds = Array.from(this.sessions.keys());
    sessionIds.forEach(sessionId => {
      this.invalidateSession(sessionId, 'server_shutdown');
    });

    logger.info('WebSocket Session Manager destroyed');
  }
}

// Export singleton instance
export let sessionManager: WebSocketSessionManager;

export const initializeSessionManager = (io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) => {
  sessionManager = new WebSocketSessionManager(io);
  return sessionManager;
}; 