import { Socket, Server as SocketIOServer } from 'socket.io';
import { logger } from '@/utils/logger';
import { validateClassAccess } from '../middleware/auth';
import { RoomManager } from '../services/roomManager';
import { RoomPermissionManager } from '../middleware/roomPermissions';
import { RoomAnalyticsManager } from '../services/roomAnalytics';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData,
  JoinClassData,
  LeaveClassData,
  AckResponse,
} from '../types/events';

export class ConnectionManager {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private classMembers: Map<string, Set<string>> = new Map(); // classId -> Set of userIds
  private roomManager: RoomManager;
  private roomPermissions: RoomPermissionManager;
  private roomAnalytics: RoomAnalyticsManager;

  constructor(
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    roomManager: RoomManager,
    roomPermissions: RoomPermissionManager,
    roomAnalytics: RoomAnalyticsManager
  ) {
    this.io = io;
    this.roomManager = roomManager;
    this.roomPermissions = roomPermissions;
    this.roomAnalytics = roomAnalytics;
  }

  public handleConnection(socket: Socket): void {
    const socketData = socket.data as SocketData;
    
    // Track user connection
    this.addUserConnection(socketData.userId, socket.id);
    
    // Join user's personal room for direct messaging
    socket.join(`user:${socketData.userId}`);
    
    // Auto-join user to their class rooms using room manager
    this.autoJoinUserRooms(socket);
    
    // Setup class room handlers
    this.setupRoomHandlers(socket);
    
    // Record connection activity
    this.recordConnectionActivity(socket, 'join');

    logger.info('Enhanced connection established', {
      userId: socketData.userId,
      socketId: socket.id,
      userRole: socketData.userRole,
      classCount: socketData.classIds.length,
    });
  }

  public handleDisconnection(socket: Socket, reason: string): void {
    const socketData = socket.data as SocketData;
    
    // Record disconnection activity for all user's rooms
    const userRooms = this.roomManager.getUserRooms(socketData.userId);
    for (const room of userRooms) {
      this.roomAnalytics.recordUserActivity(room.roomId, socketData.userId, 'leave');
    }
    
    // Remove user connection
    this.removeUserConnection(socketData.userId, socket.id);
    
    // Update class member tracking
    for (const classId of socketData.classIds) {
      const classMembers = this.classMembers.get(classId);
      if (classMembers && classMembers.has(socketData.userId)) {
        // Check if user has other active connections
        const userConnections = this.userConnections.get(socketData.userId);
        if (!userConnections || userConnections.size === 0) {
          classMembers.delete(socketData.userId);
          
          // Broadcast user offline to class
          this.broadcastUserOffline(socketData.userId, socketData, classId);
        }
      }
    }

    logger.info('Enhanced connection disconnected', {
      userId: socketData.userId,
      socketId: socket.id,
      reason,
      remainingConnections: this.userConnections.get(socketData.userId)?.size || 0,
    });
  }

  private async autoJoinUserRooms(socket: Socket): Promise<void> {
    const socketData = socket.data as SocketData;
    
    try {
      // Get user's rooms from room manager
      const userRooms = this.roomManager.getUserRooms(socketData.userId);
      
      for (const room of userRooms) {
        // Join room through room manager (this handles all the logic)
        const result = await this.roomManager.joinRoom(socket, room.roomId, {
          role: 'member',
          validateAccess: false, // User is already a member
        });

        if (result.success) {
          // Record analytics
          this.roomAnalytics.recordUserActivity(room.roomId, socketData.userId, 'join');
          
          // Track in class members if it's a class room
          if (room.roomType === 'class' && room.classId) {
            this.trackClassMember(room.classId, socketData.userId);
          }

          logger.debug('Auto-joined room', {
            userId: socketData.userId,
            roomId: room.roomId,
            roomName: room.name,
            roomType: room.roomType,
          });
        } else {
          logger.warn('Failed to auto-join room', {
            userId: socketData.userId,
            roomId: room.roomId,
            reason: result.message,
          });
        }
      }

      // Emit user's room list
      socket.emit('user:rooms_updated', {
        rooms: userRooms.map(room => ({
          roomId: room.roomId,
          name: room.name,
          roomType: room.roomType,
          memberCount: room.memberIds.size,
          isActive: room.metadata.activeMembers > 0,
        })),
        timestamp: new Date(),
      });

    } catch (error) {
      logger.error('Error auto-joining user rooms', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
      });
    }
  }

  private setupRoomHandlers(socket: Socket): void {
    // Enhanced join class handler
    socket.on('join:class', async (data: JoinClassData, callback?: (response: AckResponse) => void) => {
      await this.handleJoinClass(socket, data, callback);
    });

    // Enhanced leave class handler  
    socket.on('leave:class', async (data: LeaveClassData, callback?: (response: AckResponse) => void) => {
      await this.handleLeaveClass(socket, data, callback);
    });

    // Get room status
    socket.on('room:get_status' as any, async (data: { roomId: string }, callback?: (response: any) => void) => {
      await this.handleGetRoomStatus(socket, data, callback);
    });
  }

  private async handleJoinClass(
    socket: Socket,
    data: JoinClassData,
    callback?: (response: AckResponse) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;
    const classRoomId = `class:${data.classId}`;

    try {
      // Check permission to join class room
      const permissionCheck = this.roomPermissions.hasRoomPermission(socket, {
        roomId: classRoomId,
        action: 'class:join',
      });

      if (!permissionCheck.allowed) {
        if (callback) {
          callback({
            success: false,
            error: permissionCheck.reason || 'Permission denied',
          });
        }
        return;
      }

      // Join room through room manager
      const result = await this.roomManager.joinRoom(socket, classRoomId, {
        role: 'member',
        validateAccess: true,
      });

      if (result.success && result.roomInfo) {
        // Track class member
        this.trackClassMember(data.classId, socketData.userId);
        
        // Record analytics
        this.roomAnalytics.recordUserActivity(classRoomId, socketData.userId, 'join');

        // Get room analytics for user
        const roomMetrics = this.roomAnalytics.generateRoomMetrics(classRoomId);

        if (callback) {
          callback({
            success: true,
            data: {
              classId: data.classId,
              className: result.roomInfo.name,
              memberCount: result.roomInfo.memberIds.size,
              activeMembers: result.roomInfo.metadata.activeMembers,
              roomMetrics: roomMetrics ? {
                activeUsers: roomMetrics.activeUsers,
                userEngagement: roomMetrics.userEngagement,
              } : undefined,
            },
          });
        }

        logger.info('User joined class via enhanced handler', {
          userId: socketData.userId,
          classId: data.classId,
          className: result.roomInfo.name,
        });

      } else {
        if (callback) {
          callback({
            success: false,
            error: result.message,
          });
        }
      }

    } catch (error) {
      logger.error('Error in enhanced join class handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
        classId: data.classId,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }

  private async handleLeaveClass(
    socket: Socket,
    data: LeaveClassData,
    callback?: (response: AckResponse) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;
    const classRoomId = `class:${data.classId}`;

    try {
      // Leave room through room manager
      const result = await this.roomManager.leaveRoom(socket, classRoomId, 'user_request');

      if (result.success) {
        // Remove from class members tracking
        const classMembers = this.classMembers.get(data.classId);
        if (classMembers) {
          classMembers.delete(socketData.userId);
        }

        // Record analytics
        this.roomAnalytics.recordUserActivity(classRoomId, socketData.userId, 'leave');

        if (callback) {
          callback({
            success: true,
            data: {
              classId: data.classId,
              message: 'Left class successfully',
            },
          });
        }

        logger.info('User left class via enhanced handler', {
          userId: socketData.userId,
          classId: data.classId,
        });

      } else {
        if (callback) {
          callback({
            success: false,
            error: result.message,
          });
        }
      }

    } catch (error) {
      logger.error('Error in enhanced leave class handler', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
        classId: data.classId,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }

  private async handleGetRoomStatus(
    socket: Socket,
    data: { roomId: string },
    callback?: (response: any) => void
  ): Promise<void> {
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

      const metrics = this.roomAnalytics.generateRoomMetrics(data.roomId);
      const members = this.roomManager.getRoomMembers(data.roomId);

      if (callback) {
        callback({
          success: true,
          data: {
            room: {
              roomId: room.roomId,
              name: room.name,
              roomType: room.roomType,
              memberCount: room.memberIds.size,
              activeMembers: room.metadata.activeMembers,
              settings: room.settings,
            },
            metrics: metrics ? {
              activeUsers: metrics.activeUsers,
              messagesPerHour: metrics.messagesPerHour,
              userEngagement: metrics.userEngagement,
            } : undefined,
            members: members.map(member => ({
              userId: member.userId,
              role: member.role,
              isActive: member.lastActivity > new Date(Date.now() - 300000), // Active in last 5 minutes
              joinedAt: member.joinedAt,
            })),
          },
        });
      }

    } catch (error) {
      logger.error('Error getting room status', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId: data.roomId,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }

  private recordConnectionActivity(socket: Socket, activityType: 'join' | 'leave'): void {
    const socketData = socket.data as SocketData;
    
    // Record activity for all user's rooms
    const userRooms = this.roomManager.getUserRooms(socketData.userId);
    for (const room of userRooms) {
      this.roomAnalytics.recordUserActivity(room.roomId, socketData.userId, activityType);
    }
  }

  private trackClassMember(classId: string, userId: string): void {
    if (!this.classMembers.has(classId)) {
      this.classMembers.set(classId, new Set());
    }
    this.classMembers.get(classId)!.add(userId);
  }

  private addUserConnection(userId: string, socketId: string): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(socketId);
  }

  private removeUserConnection(userId: string, socketId: string): void {
    const userSockets = this.userConnections.get(userId);
    if (userSockets) {
      userSockets.delete(socketId);
      if (userSockets.size === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  private broadcastUserOffline(userId: string, socketData: SocketData, classId: string): void {
    const classRoomId = `class:${classId}`;
    this.io.to(classRoomId).emit('user:left_class', {
      userId: userId,
      userName: `User ${userId}`, // Would get actual name from user data
      classId: classId,
      className: `Class ${classId}`, // Would get actual class name
      timestamp: new Date(),
    });
  }

  // Public methods for external access
  public getConnectedUsers(): Map<string, Set<string>> {
    return this.userConnections;
  }

  public getClassMembers(classId: string): string[] {
    return Array.from(this.classMembers.get(classId) || []);
  }

  public isUserConnected(userId: string): boolean {
    const connections = this.userConnections.get(userId);
    return connections ? connections.size > 0 : false;
  }

  public getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }

  // Enhanced connection statistics
  public getConnectionStats(): {
    totalConnections: number;
    uniqueUsers: number;
    usersByClass: Record<string, number>;
    connectionsByRole: Record<string, number>;
  } {
    const totalConnections = Array.from(this.userConnections.values())
      .reduce((sum, sockets) => sum + sockets.size, 0);
    
    const uniqueUsers = this.userConnections.size;
    
    const usersByClass: Record<string, number> = {};
    for (const [classId, members] of this.classMembers) {
      usersByClass[classId] = members.size;
    }

    // This would need socket data to calculate roles
    const connectionsByRole: Record<string, number> = {};

    return {
      totalConnections,
      uniqueUsers,
      usersByClass,
      connectionsByRole,
    };
  }
} 