import { Server as SocketIOServer } from 'socket.io';
import { Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';
import { authenticateSocketEnhanced, enhancedAuth } from './middleware/authEnhanced';
import { WebSocketAuthorization } from './middleware/authorization';
import { initializeSessionManager } from './services/sessionManager';
import { RoomManager } from './services/roomManager';
import { RoomPermissionManager } from './middleware/roomPermissions';
import { RoomAnalyticsManager } from './services/roomAnalytics';
import { ConnectionManager } from './handlers/connectionManager';
import { MessageHandler } from './handlers/messageHandler';
import { PresenceHandler } from './handlers/presenceHandler';
import { RoomHandler } from './handlers/roomHandler';
import { RateLimiter } from './middleware/rateLimiter';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from './types/events';

export class WebSocketServer {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private roomManager: RoomManager;
  private roomPermissions: RoomPermissionManager;
  private roomAnalytics: RoomAnalyticsManager;
  private connectionManager: ConnectionManager;
  private messageHandler: MessageHandler;
  private presenceHandler: PresenceHandler;
  private roomHandler: RoomHandler;
  private rateLimiter: RateLimiter;
  private sessionManager: any;

  constructor(httpServer: HTTPServer) {
    // Initialize Socket.IO server with configuration
    this.io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
      httpServer,
      {
        cors: {
          origin: config.cors.origin,
          methods: ['GET', 'POST'],
          credentials: config.cors.credentials,
        },
        pingTimeout: 60000, // 60 seconds
        pingInterval: 25000, // 25 seconds
        maxHttpBufferSize: 1e6, // 1MB
        transports: ['websocket', 'polling'],
        allowEIO3: false, // Disable Engine.IO v3 compatibility
        serveClient: false, // Don't serve client files
      }
    );

    // Initialize services and handlers in correct order
    this.sessionManager = initializeSessionManager(this.io);
    this.roomManager = new RoomManager(this.io);
    this.roomPermissions = new RoomPermissionManager(this.roomManager);
    this.roomAnalytics = new RoomAnalyticsManager(this.io, this.roomManager);
    this.connectionManager = new ConnectionManager(this.io, this.roomManager, this.roomPermissions, this.roomAnalytics);
    this.messageHandler = new MessageHandler(this.io);
    this.presenceHandler = new PresenceHandler(this.io);
    this.roomHandler = new RoomHandler(this.io, this.roomManager);
    this.rateLimiter = new RateLimiter();

    this.setupMiddleware();
    this.setupEventHandlers();
    this.setupAdminHandlers();
    this.setupRoomAnalyticsHandlers();

    logger.info('Enhanced WebSocket server with room management initialized', {
      corsOrigin: config.cors.origin,
      environment: config.nodeEnv,
      features: [
        'authentication', 
        'authorization', 
        'session_management', 
        'rate_limiting',
        'room_management',
        'room_permissions',
        'room_analytics'
      ],
    });
  }

  private setupMiddleware(): void {
    // Enhanced authentication middleware
    this.io.use(authenticateSocketEnhanced);

    // Rate limiting middleware
    this.io.use((socket, next) => {
      (socket as any).rateLimiter = this.rateLimiter;
      next();
    });

    // Add authorization helper to socket
    this.io.use((socket, next) => {
      (socket as any).auth = WebSocketAuthorization;
      next();
    });

    // Add room services to socket for easy access
    this.io.use((socket, next) => {
      (socket as any).roomManager = this.roomManager;
      (socket as any).roomPermissions = this.roomPermissions;
      (socket as any).roomAnalytics = this.roomAnalytics;
      next();
    });

    logger.info('Enhanced WebSocket middleware configured');
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      const socketData = socket.data as SocketData;
      
      logger.info('Enhanced WebSocket connection established', {
        socketId: socket.id,
        userId: socketData.userId,
        userRole: socketData.userRole,
        classIds: socketData.classIds,
        ip: socketData.ipAddress,
        userAgent: socketData.userAgent,
      });

      // Create session for the connection
      const sessionId = this.sessionManager.createSession(socket);
      if (sessionId) {
        (socket as any).sessionId = sessionId;
      }

      // Update activity timestamp on any event
      socket.use(([event, ...args], next) => {
        // Update session activity
        if (sessionId) {
          this.sessionManager.updateSessionActivity(sessionId);
        }
        
        // Update auth activity
        enhancedAuth.refreshUserSession(socketData.userId);
        
        // Record room activity for message events
        if (event.includes('message') || event.includes('room')) {
          const userRooms = this.roomManager.getUserRooms(socketData.userId);
          for (const room of userRooms) {
            this.roomAnalytics.recordUserActivity(room.roomId, socketData.userId, 'message');
          }
        }
        
        next();
      });

      // Enhanced connection management
      this.connectionManager.handleConnection(socket);

      // Enhanced message events with room integration
      this.messageHandler.setupEventHandlers(socket);

      // Presence events
      this.presenceHandler.setupEventHandlers(socket);

      // Enhanced room event handlers
      this.roomHandler.setupEventHandlers(socket);

      // Setup permission-based event handlers
      this.setupPermissionEventHandlers(socket);

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info('Enhanced WebSocket connection disconnected', {
          socketId: socket.id,
          userId: socketData.userId,
          reason: reason,
          connectionDuration: Date.now() - socketData.connectionTime.getTime(),
        });

        // Handle cleanup in correct order
        this.connectionManager.handleDisconnection(socket, reason);
        this.presenceHandler.handleDisconnection(socket);
        this.sessionManager.handleDisconnection(socket);
        enhancedAuth.handleDisconnection(socket);
      });

      // Handle errors with enhanced logging
      socket.on('error', (error) => {
        const session = enhancedAuth.getSession(socket.id);
        
        logger.error('Enhanced WebSocket error', {
          socketId: socket.id,
          userId: socketData.userId,
          sessionId: session?.sessionId,
          error: error.message,
          stack: error.stack,
          userAgent: socketData.userAgent,
          ip: socketData.ipAddress,
        });
      });
    });

    // Global error handling
    this.io.engine.on('connection_error', (err) => {
      logger.error('WebSocket engine connection error', {
        code: err.code,
        message: err.message,
        context: err.context,
        type: err.type,
      });
    });

    logger.info('Enhanced WebSocket event handlers configured');
  }

  private setupPermissionEventHandlers(socket: Socket): void {
    // User management events (admin only)
    socket.on('admin:get_users' as any, async (data: any, callback?: (response: any) => void) => {
      // Check admin permission
      if (!WebSocketAuthorization.hasPermission(socket, 'user:manage')) {
        if (callback) {
          callback({
            success: false,
            error: 'Admin permission required',
          });
        }
        return;
      }

      // This would be implemented with proper user management logic
      logger.info('Admin users request', { 
        adminId: socket.data?.userId,
        socketId: socket.id 
      });
      
      if (callback) {
        callback({
          success: true,
          message: 'User management not yet implemented - Task 3',
          data: [],
        });
      }
    });

    // Get user permissions
    socket.on('auth:get_permissions' as any, async (callback?: (response: any) => void) => {
      try {
        const permissions = WebSocketAuthorization.getUserPermissions(socket);
        const session = enhancedAuth.getSession(socket.id);
        
        if (callback) {
          callback({
            success: true,
            data: {
              permissions,
              role: socket.data?.userRole,
              classIds: socket.data?.classIds,
              sessionInfo: session ? {
                sessionId: session.sessionId,
                lastActivity: session.lastActivity,
                permissions: session.permissions,
              } : null,
            },
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get permissions',
          });
        }
      }
    });

    // System broadcast (admin only)
    socket.on('system:broadcast' as any, async (data: { message: string; targetRoles?: string[]; priority?: string }, callback?: (response: any) => void) => {
      // Check admin permission
      if (!WebSocketAuthorization.hasPermission(socket, 'system:broadcast')) {
        if (callback) {
          callback({
            success: false,
            error: 'Admin permission required for system broadcasts',
          });
        }
        return;
      }

      try {
        const notification = {
          id: `broadcast_${Date.now()}`,
          type: 'system',
          title: 'System Announcement',
          message: data.message,
          priority: data.priority || 'medium',
          createdAt: new Date(),
        };

        this.broadcastSystemNotification(notification, data.targetRoles as any);

        logger.info('System broadcast sent', {
          adminId: socket.data?.userId,
          message: data.message,
          targetRoles: data.targetRoles,
        });

        if (callback) {
          callback({
            success: true,
            message: 'Broadcast sent successfully',
          });
        }
      } catch (error) {
        if (callback) {
          callback({
            success: false,
            error: error instanceof Error ? error.message : 'Broadcast failed',
          });
        }
      }
    });
  }

  private setupAdminHandlers(): void {
    this.io.on('connection', (socket) => {
      // Admin session management
      socket.on('admin:get_sessions' as any, async (callback?: (response: any) => void) => {
        // Check admin permission
        if (!WebSocketAuthorization.hasPermission(socket, 'system:maintenance')) {
          if (callback) {
            callback({
              success: false,
              error: 'Admin permission required',
            });
          }
          return;
        }

        try {
          const sessions = this.sessionManager.getDetailedSessions();
          const stats = this.sessionManager.getSessionStats();
          const authStats = enhancedAuth.getStats();

          if (callback) {
            callback({
              success: true,
              data: {
                sessions: sessions.map((s: any) => ({
                  sessionId: s.sessionId,
                  userId: s.userId,
                  role: s.role,
                  createdAt: s.createdAt,
                  lastActivity: s.lastActivity,
                  ipAddress: s.ipAddress,
                  userAgent: s.userAgent,
                })),
                stats,
                authStats,
              },
            });
          }
        } catch (error) {
          if (callback) {
            callback({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to get sessions',
            });
          }
        }
      });

      // Admin room management
      socket.on('admin:get_rooms' as any, async (callback?: (response: any) => void) => {
        if (!WebSocketAuthorization.hasPermission(socket, 'system:maintenance')) {
          if (callback) {
            callback({
              success: false,
              error: 'Admin permission required',
            });
          }
          return;
        }

        try {
          const allRooms = this.roomManager.getAllRooms();
          const roomStats = this.roomManager.getRoomStats();
          const realTimeAnalytics = this.roomAnalytics.getRealTimeAnalytics();

          if (callback) {
            callback({
              success: true,
              data: {
                rooms: allRooms.map(room => ({
                  roomId: room.roomId,
                  name: room.name,
                  roomType: room.roomType,
                  memberCount: room.memberIds.size,
                  activeMembers: room.metadata.activeMembers,
                  createdAt: room.createdAt,
                  lastActivity: room.lastActivity,
                })),
                stats: roomStats,
                analytics: realTimeAnalytics,
              },
            });
          }
        } catch (error) {
          if (callback) {
            callback({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to get rooms',
            });
          }
        }
      });

      // Admin force disconnect user
      socket.on('admin:disconnect_user' as any, async (data: { userId: string; reason?: string }, callback?: (response: any) => void) => {
        // Check admin permission
        if (!WebSocketAuthorization.hasPermission(socket, 'user:manage')) {
          if (callback) {
            callback({
              success: false,
              error: 'Admin permission required',
            });
          }
          return;
        }

        try {
          const reason = data.reason || 'Admin disconnection';
          const invalidatedCount = await this.sessionManager.invalidateUserSessions(data.userId, reason);

          logger.warn('Admin forced user disconnection', {
            adminId: socket.data?.userId,
            targetUserId: data.userId,
            reason,
            invalidatedSessions: invalidatedCount,
          });

          if (callback) {
            callback({
              success: true,
              message: `Disconnected user from ${invalidatedCount} sessions`,
              data: { invalidatedSessions: invalidatedCount },
            });
          }
        } catch (error) {
          if (callback) {
            callback({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to disconnect user',
            });
          }
        }
      });
    });
  }

  private setupRoomAnalyticsHandlers(): void {
    this.io.on('connection', (socket) => {
      // Get room analytics (moderator+ only)
      socket.on('analytics:get_room' as any, async (data: { roomId: string; period?: string }, callback?: (response: any) => void) => {
        try {
          const room = this.roomManager.getRoomInfo(data.roomId);
          if (!room) {
            if (callback) {
              callback({
                success: false,
                error: 'Room not found',
              });
            }
            return;
          }

          // Check permission to view analytics
          const canView = room.ownerId === socket.data?.userId || 
                         room.moderatorIds.has(socket.data?.userId || '') ||
                         WebSocketAuthorization.hasPermission(socket, 'analytics:view');

          if (!canView) {
            if (callback) {
              callback({
                success: false,
                error: 'Permission denied: Cannot view room analytics',
              });
            }
            return;
          }

          const period = (data.period || 'day') as any;
          const insights = this.roomAnalytics.generateRoomInsights(data.roomId, period);
          const healthMetrics = this.roomAnalytics.generateRoomHealthMetrics(data.roomId);
          const currentMetrics = this.roomAnalytics.generateRoomMetrics(data.roomId);

          if (callback) {
            callback({
              success: true,
              data: {
                insights,
                healthMetrics,
                currentMetrics,
              },
            });
          }

        } catch (error) {
          if (callback) {
            callback({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to get analytics',
            });
          }
        }
      });

      // Get global analytics (admin only)
      socket.on('analytics:get_global' as any, async (callback?: (response: any) => void) => {
        if (!WebSocketAuthorization.hasPermission(socket, 'system:maintenance')) {
          if (callback) {
            callback({
              success: false,
              error: 'Admin permission required',
            });
          }
          return;
        }

        try {
          const realTimeAnalytics = this.roomAnalytics.getRealTimeAnalytics();
          const connectionStats = this.getConnectionStats();

          if (callback) {
            callback({
              success: true,
              data: {
                realTimeAnalytics,
                connectionStats,
                timestamp: new Date(),
              },
            });
          }
        } catch (error) {
          if (callback) {
            callback({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to get global analytics',
            });
          }
        }
      });
    });
  }

  // Enhanced broadcasting methods with authorization
  public broadcastToClass(classId: string, event: keyof ServerToClientEvents, data: any): void {
    const roomId = `class:${classId}`;
    this.io.to(roomId).emit(event, data);
    logger.debug('Broadcast to class', { classId, event, roomId });
  }

  public broadcastToUser(userId: string, event: keyof ServerToClientEvents, data: any): void {
    const roomId = `user:${userId}`;
    this.io.to(roomId).emit(event, data);
    logger.debug('Broadcast to user', { userId, event, roomId });
  }

  public broadcastToRole(role: 'STUDENT' | 'TEACHER' | 'ADMIN', event: keyof ServerToClientEvents, data: any): void {
    const sockets = Array.from(this.io.sockets.sockets.values())
      .filter(socket => socket.data.userRole === role);
    
    sockets.forEach(socket => {
      socket.emit(event, data);
    });

    logger.debug('Broadcast to role', { role, event, socketCount: sockets.length });
  }

  // Enhanced system notifications with permission checking
  public broadcastSystemNotification(
    notification: any, 
    targetRoles?: Array<'STUDENT' | 'TEACHER' | 'ADMIN'>
  ): void {
    if (targetRoles) {
      targetRoles.forEach(role => {
        this.broadcastToRole(role, 'notification:new', notification);
      });
    } else {
      this.io.emit('notification:new', notification);
    }
    
    logger.info('System notification broadcast', { 
      targetRoles: targetRoles || 'all', 
      notificationType: notification.type,
      notificationId: notification.id,
    });
  }

  // Enhanced connection statistics
  public getConnectionStats(): {
    totalConnections: number;
    usersByRole: Record<string, number>;
    activeRooms: number;
    sessionStats: any;
    authStats: any;
    rateLimiterStats: any;
    roomStats: any;
    roomAnalytics: any;
  } {
    const sockets = Array.from(this.io.sockets.sockets.values());
    const usersByRole: Record<string, number> = {};
    
    sockets.forEach(socket => {
      const role = socket.data.userRole;
      usersByRole[role] = (usersByRole[role] || 0) + 1;
    });

    return {
      totalConnections: sockets.length,
      usersByRole,
      activeRooms: this.io.sockets.adapter.rooms.size,
      sessionStats: this.sessionManager.getSessionStats(),
      authStats: enhancedAuth.getStats(),
      rateLimiterStats: this.rateLimiter.getStats(),
      roomStats: this.roomManager.getRoomStats(),
      roomAnalytics: this.roomAnalytics.getRealTimeAnalytics(),
    };
  }

  // Enhanced room management methods
  public async createRoom(creatorId: string, roomData: any): Promise<any> {
    return await this.roomManager.createRoom(creatorId, roomData);
  }

  public getRoomInfo(roomId: string): any {
    return this.roomManager.getRoomInfo(roomId);
  }

  public getRoomAnalytics(roomId: string, period: string = 'day'): any {
    return this.roomAnalytics.generateRoomInsights(roomId, period as any);
  }

  // Enhanced session management methods
  public async invalidateUserSessions(userId: string, reason: string = 'admin_action'): Promise<number> {
    const sessionCount = await this.sessionManager.invalidateUserSessions(userId, reason);
    await enhancedAuth.invalidateUserSessions(userId);
    
    logger.info('User sessions invalidated via WebSocket server', {
      userId,
      sessionCount,
      reason,
    });
    
    return sessionCount;
  }

  public async extendUserSession(userId: string, additionalTime: number = 3600000): Promise<boolean> {
    const sessions = this.sessionManager.getUserSessions(userId);
    let extended = 0;
    
    for (const session of sessions) {
      if (this.sessionManager.extendSession(session.sessionId, additionalTime)) {
        extended++;
      }
    }
    
    return extended > 0;
  }

  // Enhanced shutdown with proper cleanup
  public async shutdown(): Promise<void> {
    logger.info('Starting enhanced WebSocket server shutdown...');
    
    // Notify all connected clients
    this.io.emit('system:maintenance', {
      type: 'maintenance',
      title: 'Server Maintenance',
      message: 'Server is shutting down for maintenance. Please reconnect in a few moments.',
      severity: 'warning',
    });

    // Wait for message delivery
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Cleanup services in correct order
    if (this.roomAnalytics) {
      this.roomAnalytics.destroy();
    }
    
    if (this.roomManager) {
      this.roomManager.destroy();
    }
    
    if (this.sessionManager) {
      this.sessionManager.destroy();
    }
    
    if (this.rateLimiter) {
      this.rateLimiter.destroy();
    }

    enhancedAuth.cleanup();

    // Close connections
    this.io.close();
    
    logger.info('Enhanced WebSocket server shutdown complete');
  }

  // Get enhanced monitoring data
  public getMonitoringData(): any {
    return {
      connections: this.getConnectionStats(),
      sessions: this.sessionManager.getSessionStats(),
      permissions: WebSocketAuthorization.getAuthStats(),
      rateLimiting: this.rateLimiter.getStats(),
      rooms: this.roomManager.getRoomStats(),
      analytics: this.roomAnalytics.getRealTimeAnalytics(),
      uptime: process.uptime(),
      timestamp: new Date(),
    };
  }

  // Get the Socket.IO instance
  public getIO(): SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> {
    return this.io;
  }
} 