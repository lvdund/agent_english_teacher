import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '@/config/environment';
import { getPrismaClient } from '@/config/database';
import { logger } from '@/utils/logger';
import { createRedisClient } from '@/config/redis';
import type { SocketData, AuthErrorEventData } from '../types/events';

const prisma = getPrismaClient();
const redis = createRedisClient();

interface JWTPayload {
  id: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  sessionId?: string;
  iat: number;
  exp: number;
}

interface UserSession {
  userId: string;
  sessionId: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  classIds: string[];
  permissions: Record<string, boolean>;
  lastActivity: Date;
  ipAddress: string;
  userAgent: string;
  deviceInfo?: {
    type: 'desktop' | 'mobile' | 'tablet';
    browser: string;
    os: string;
  };
}

export class EnhancedWebSocketAuth {
  private activeSessions: Map<string, UserSession> = new Map();
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private failedAttempts: Map<string, { count: number; lastAttempt: Date }> = new Map();

  // Enhanced authentication with session management
  public authenticate = async (socket: Socket, next: (err?: Error) => void): Promise<void> => {
    const startTime = Date.now();
    const clientIP = socket.handshake.address;
    const userAgent = socket.handshake.headers['user-agent'] || '';

    try {
      // Extract token from multiple sources
      const token = this.extractToken(socket);
      
      if (!token) {
        await this.logAuthFailure(socket, 'no_token', 'Authentication token required');
        return next(new Error('Authentication token required'));
      }

      // Check for rate limiting on failed attempts
      if (this.isRateLimited(clientIP)) {
        await this.logAuthFailure(socket, 'rate_limited', 'Too many failed authentication attempts');
        return next(new Error('Too many failed authentication attempts. Please try again later.'));
      }

      // Verify and decode JWT token
      const decoded = await this.verifyToken(token);
      if (!decoded) {
        await this.recordFailedAttempt(clientIP);
        await this.logAuthFailure(socket, 'invalid_token', 'Invalid authentication token');
        return next(new Error('Invalid authentication token'));
      }

      // Check token expiration with grace period
      if (this.isTokenExpired(decoded)) {
        await this.logAuthFailure(socket, 'expired_token', 'Token has expired');
        
        // Emit token expired event to client for refresh
        socket.emit('auth:error', {
          reason: 'expired_token',
          message: 'Your session has expired. Please refresh your token.',
          timestamp: new Date(),
        });
        
        return next(new Error('Token has expired'));
      }

      // Fetch user with enhanced details
      const user = await this.fetchUserWithPermissions(decoded.id);
      if (!user) {
        await this.logAuthFailure(socket, 'user_not_found', 'User not found or inactive');
        return next(new Error('User not found or inactive'));
      }

      // Check if user account is active and not suspended
      if (!user.isActive) {
        await this.logAuthFailure(socket, 'account_suspended', 'User account is suspended');
        
        socket.emit('auth:error', {
          reason: 'insufficient_permissions',
          message: 'Your account has been suspended. Please contact support.',
          timestamp: new Date(),
        });
        
        return next(new Error('Account suspended'));
      }

      // Create or update user session
      const session = await this.createUserSession(user, socket, decoded);
      
      // Set enhanced socket data
      const socketData: SocketData = {
        userId: user.id,
        userRole: user.role,
        classIds: session.classIds,
        connectionTime: new Date(),
        lastActivity: new Date(),
        ipAddress: clientIP,
        userAgent: userAgent,
      };

      socket.data = socketData;

      // Store session information
      this.activeSessions.set(socket.id, session);
      this.addUserSocket(user.id, socket.id);

      // Clear failed attempts on successful auth
      this.failedAttempts.delete(clientIP);

      // Log successful authentication
      await this.logAuthSuccess(socket, user, Date.now() - startTime);

      next();

    } catch (error) {
      await this.recordFailedAttempt(clientIP);
      await this.logAuthFailure(socket, 'auth_error', error instanceof Error ? error.message : 'Authentication failed');
      next(new Error('Authentication failed'));
    }
  };

  // Enhanced token verification with blacklist check
  private async verifyToken(token: string): Promise<JWTPayload | null> {
    try {
      // Check if token is blacklisted (for logout functionality)
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return null;
      }

      const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
      return decoded;
    } catch (error) {
      logger.warn('JWT verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  // Extract token from multiple sources
  private extractToken(socket: Socket): string | null {
    // Priority: auth object, query parameter, headers
    return (
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
      null
    );
  }

  // Check if token is expired with grace period
  private isTokenExpired(decoded: JWTPayload): boolean {
    const now = Math.floor(Date.now() / 1000);
    const gracePeriod = 300; // 5 minutes grace period
    return decoded.exp < (now - gracePeriod);
  }

  // Fetch user with permissions and class memberships
  private async fetchUserWithPermissions(userId: string) {
    return await prisma.user.findUnique({
      where: { 
        id: userId,
      },
      include: {
        memberships: {
          where: { isActive: true },
          include: {
            class: {
              select: {
                id: true,
                name: true,
                status: true,
                teacherId: true,
              },
            },
          },
        },
      },
    });
  }

  // Create user session with permissions
  private async createUserSession(user: any, socket: Socket, decoded: JWTPayload): Promise<UserSession> {
    const classIds = user.memberships.map((m: any) => m.classId);
    
    // Calculate user permissions based on role and memberships
    const permissions = this.calculateUserPermissions(user);

    const deviceInfo = this.parseDeviceInfo(socket.handshake.headers['user-agent']);

    const session: UserSession = {
      userId: user.id,
      sessionId: decoded.sessionId || `session_${Date.now()}_${Math.random()}`,
      role: user.role,
      classIds,
      permissions,
      lastActivity: new Date(),
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'] || '',
      ...(deviceInfo && { deviceInfo }),
    };

    // Store session in Redis for persistence across server restarts
    await this.storeSessionInRedis(session);

    return session;
  }

  // Calculate user permissions based on role and memberships
  private calculateUserPermissions(user: any): Record<string, boolean> {
    const permissions: Record<string, boolean> = {
      'message:send': true,
      'message:edit': true,
      'message:delete': false,
      'typing:start': true,
      'typing:stop': true,
      'presence:update': true,
      'join:class': true,
      'leave:class': true,
    };

    // Admin permissions
    if (user.role === 'ADMIN') {
      permissions['message:delete'] = true;
      permissions['user:manage'] = true;
      permissions['class:manage'] = true;
      permissions['system:broadcast'] = true;
    }

    // Teacher permissions
    if (user.role === 'TEACHER') {
      permissions['message:delete'] = true;
      permissions['class:manage'] = true;
      permissions['student:manage'] = true;
    }

    // Add class-specific permissions
    user.memberships.forEach((membership: any) => {
      if (membership.role === 'TEACHER') {
        permissions[`class:${membership.classId}:manage`] = true;
        permissions[`class:${membership.classId}:moderate`] = true;
      }
    });

    return permissions;
  }

  // Parse device information from user agent
  private parseDeviceInfo(userAgent?: string): UserSession['deviceInfo'] {
    if (!userAgent) return undefined;

    let type: 'desktop' | 'mobile' | 'tablet' = 'desktop';
    let browser = 'unknown';
    let os = 'unknown';

    // Simple device detection
    if (/Mobile|Android|iPhone|iPad/.test(userAgent)) {
      type = /iPad/.test(userAgent) ? 'tablet' : 'mobile';
    }

    // Browser detection
    if (/Chrome/.test(userAgent)) browser = 'Chrome';
    else if (/Firefox/.test(userAgent)) browser = 'Firefox';
    else if (/Safari/.test(userAgent)) browser = 'Safari';
    else if (/Edge/.test(userAgent)) browser = 'Edge';

    // OS detection
    if (/Windows/.test(userAgent)) os = 'Windows';
    else if (/Mac/.test(userAgent)) os = 'macOS';
    else if (/Linux/.test(userAgent)) os = 'Linux';
    else if (/Android/.test(userAgent)) os = 'Android';
    else if (/iOS/.test(userAgent)) os = 'iOS';

    return { type, browser, os };
  }

  // Store session in Redis
  private async storeSessionInRedis(session: UserSession): Promise<void> {
    try {
      const key = `ws_session:${session.sessionId}`;
      await redis.setex(key, 86400, JSON.stringify(session)); // 24 hours TTL
    } catch (error) {
      logger.warn('Failed to store session in Redis', {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Check if token is blacklisted
  private async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const blacklisted = await redis.get(`blacklist:${token}`);
      return !!blacklisted;
    } catch (error) {
      logger.warn('Failed to check token blacklist', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  // Rate limiting for failed attempts
  private isRateLimited(ip: string): boolean {
    const attempt = this.failedAttempts.get(ip);
    if (!attempt) return false;

    const timeDiff = Date.now() - attempt.lastAttempt.getTime();
    const lockoutTime = Math.min(attempt.count * 1000 * 60, 1000 * 60 * 30); // Max 30 minutes

    return attempt.count >= 5 && timeDiff < lockoutTime;
  }

  // Record failed authentication attempt
  private async recordFailedAttempt(ip: string): Promise<void> {
    const current = this.failedAttempts.get(ip) || { count: 0, lastAttempt: new Date() };
    current.count++;
    current.lastAttempt = new Date();
    this.failedAttempts.set(ip, current);

    // Log security event
    logger.warn('Failed WebSocket authentication attempt', {
      ip,
      attempts: current.count,
      lockoutActive: this.isRateLimited(ip),
    });
  }

  // User socket tracking
  private addUserSocket(userId: string, socketId: string): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
  }

  private removeUserSocket(userId: string, socketId: string): void {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  // Enhanced logging methods
  private async logAuthSuccess(socket: Socket, user: any, responseTime: number): Promise<void> {
    logger.info('WebSocket authentication successful', {
      userId: user.id,
      email: user.email,
      role: user.role,
      socketId: socket.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      responseTime,
      classCount: user.memberships?.length || 0,
    });
  }

  private async logAuthFailure(
    socket: Socket, 
    reason: string, 
    message: string
  ): Promise<void> {
    logger.warn('WebSocket authentication failed', {
      reason,
      message,
      socketId: socket.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      timestamp: new Date().toISOString(),
    });

    // Also emit auth error to client
    socket.emit('auth:error', {
      reason: reason as any,
      message,
      timestamp: new Date(),
    });
  }

  // Session management methods
  public async refreshUserSession(userId: string): Promise<void> {
    const userSocketIds = this.userSockets.get(userId);
    if (!userSocketIds) return;

    // Update last activity for all user sessions
    for (const socketId of userSocketIds) {
      const session = this.activeSessions.get(socketId);
      if (session) {
        session.lastActivity = new Date();
        await this.storeSessionInRedis(session);
      }
    }
  }

  public async invalidateUserSessions(userId: string): Promise<void> {
    const userSocketIds = this.userSockets.get(userId);
    if (!userSocketIds) return;

    // Remove all sessions for user
    for (const socketId of userSocketIds) {
      this.activeSessions.delete(socketId);
    }
    this.userSockets.delete(userId);

    logger.info('User sessions invalidated', { userId, sessionCount: userSocketIds.size });
  }

  public async blacklistToken(token: string, expiresIn: number = 86400): Promise<void> {
    try {
      await redis.setex(`blacklist:${token}`, expiresIn, 'true');
      logger.info('Token blacklisted', { tokenHash: this.hashToken(token) });
    } catch (error) {
      logger.error('Failed to blacklist token', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private hashToken(token: string): string {
    // Create a hash for logging purposes (don't log actual tokens)
    return Buffer.from(token).toString('base64').substring(0, 8) + '...';
  }

  // Cleanup methods
  public cleanup(): void {
    // Clean up expired sessions and failed attempts
    const now = Date.now();
    
    // Clean failed attempts older than 1 hour
    for (const [ip, attempt] of this.failedAttempts) {
      if (now - attempt.lastAttempt.getTime() > 3600000) {
        this.failedAttempts.delete(ip);
      }
    }

    logger.debug('Auth middleware cleanup completed', {
      activeSessions: this.activeSessions.size,
      trackedUsers: this.userSockets.size,
      failedAttempts: this.failedAttempts.size,
    });
  }

  // Public getters for monitoring
  public getStats() {
    return {
      activeSessions: this.activeSessions.size,
      connectedUsers: this.userSockets.size,
      failedAttempts: this.failedAttempts.size,
    };
  }

  public getUserSessions(userId: string): string[] {
    return Array.from(this.userSockets.get(userId) || []);
  }

  public getSession(socketId: string): UserSession | undefined {
    return this.activeSessions.get(socketId);
  }

  // Handle disconnection
  public handleDisconnection(socket: Socket): void {
    const session = this.activeSessions.get(socket.id);
    if (session) {
      this.removeUserSocket(session.userId, socket.id);
      this.activeSessions.delete(socket.id);
      
      logger.debug('WebSocket session cleaned up', {
        userId: session.userId,
        socketId: socket.id,
        sessionDuration: Date.now() - session.lastActivity.getTime(),
      });
    }
  }
}

// Create singleton instance
export const enhancedAuth = new EnhancedWebSocketAuth();

// Export the middleware function
export const authenticateSocketEnhanced = enhancedAuth.authenticate; 