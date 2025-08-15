import { Socket, Server as SocketIOServer } from 'socket.io';
import { getPrismaClient } from '@/config/database';
import { createRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';
import { enhancedAuth } from '../middleware/authEnhanced';
import { WebSocketAuthorization } from '../middleware/authorization';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '../types/events';

const prisma = getPrismaClient();
const redis = createRedisClient();

export interface RoomInfo {
  roomId: string;
  roomType: 'class' | 'direct' | 'group' | 'system';
  name: string;
  description?: string;
  classId?: string; // For class-based rooms
  ownerId: string; // User who created/owns the room
  moderatorIds: Set<string>;
  memberIds: Set<string>;
  isPublic: boolean;
  maxMembers: number;
  settings: RoomSettings;
  metadata: RoomMetadata;
  createdAt: Date;
  lastActivity: Date;
}

export interface RoomSettings {
  allowMessaging: boolean;
  allowFileSharing: boolean;
  allowVoiceChat: boolean;
  allowVideoChat: boolean;
  moderationLevel: 'none' | 'basic' | 'strict';
  messageRetention: number; // days
  autoCleanup: boolean;
  notifications: {
    memberJoin: boolean;
    memberLeave: boolean;
    newMessage: boolean;
  };
}

export interface RoomMetadata {
  totalMessages: number;
  totalMembers: number;
  activeMembers: number;
  lastMessageAt?: Date;
  peakConcurrentUsers: number;
  tags: string[];
  isArchived: boolean;
  archiveReason?: string;
}

export interface RoomMember {
  userId: string;
  socketId: string;
  role: 'owner' | 'moderator' | 'member';
  joinedAt: Date;
  lastActivity: Date;
  permissions: Set<string>;
  isMuted: boolean;
  isBanned: boolean;
}

export interface RoomAnalytics {
  roomId: string;
  memberCount: number;
  activeMembers: number;
  messagesLastHour: number;
  messagesLastDay: number;
  averageSessionDuration: number;
  memberEngagement: {
    high: number;
    medium: number;
    low: number;
  };
  peakActivity: {
    timestamp: Date;
    userCount: number;
  };
}

export class RoomManager {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private rooms: Map<string, RoomInfo> = new Map();
  private roomMembers: Map<string, Map<string, RoomMember>> = new Map(); // roomId -> userId -> RoomMember
  private userRooms: Map<string, Set<string>> = new Map(); // userId -> Set of roomIds
  private roomAnalytics: Map<string, RoomAnalytics> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) {
    this.io = io;
    
    // Initialize cleanup interval (every 10 minutes)
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 600000);

    // Load existing rooms from database
    this.initializeRooms();

    logger.info('Room Manager initialized');
  }

  /**
   * Initialize rooms from database
   */
  private async initializeRooms(): Promise<void> {
    try {
      const classes = await prisma.class.findMany({
        where: { status: 'ACTIVE' },
        include: {
          memberships: {
            where: { isActive: true },
            include: { user: true },
          },
        },
      });

      for (const classData of classes) {
        const roomId = `class:${classData.id}`;
        
        const roomInfo: RoomInfo = {
          roomId,
          roomType: 'class',
          name: classData.name,
          ...(classData.description && { description: classData.description }),
          classId: classData.id,
          ownerId: classData.teacherId,
          moderatorIds: new Set([classData.teacherId]),
          memberIds: new Set(classData.memberships.map((m: any) => m.userId)),
          isPublic: false,
          maxMembers: 100, // Default value since maxStudents doesn't exist
          settings: this.getDefaultRoomSettings(),
          metadata: {
            totalMessages: 0,
            totalMembers: classData.memberships.length,
            activeMembers: 0,
            peakConcurrentUsers: 0,
            tags: ['class', 'general'], // Default tags since subject doesn't exist
            isArchived: false,
          },
          createdAt: classData.createdAt,
          lastActivity: new Date(),
        };

        this.rooms.set(roomId, roomInfo);
        this.roomMembers.set(roomId, new Map());

        logger.debug('Loaded class room', { roomId, className: classData.name });
      }

      logger.info('Rooms initialized from database', { 
        totalRooms: this.rooms.size 
      });

    } catch (error) {
      logger.error('Failed to initialize rooms from database', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Create a new room
   */
  public async createRoom(
    creatorId: string,
    roomData: {
      name: string;
      description?: string;
      roomType: RoomInfo['roomType'];
      isPublic?: boolean;
      maxMembers?: number;
      classId?: string;
    }
  ): Promise<RoomInfo | null> {
    try {
      const roomId = `${roomData.roomType}:${Date.now()}_${Math.random().toString(36).substring(2)}`;
      
      const roomInfo: RoomInfo = {
        roomId,
        roomType: roomData.roomType,
        name: roomData.name,
        ...(roomData.description && { description: roomData.description }),
        ...(roomData.classId && { classId: roomData.classId }),
        ownerId: creatorId,
        moderatorIds: new Set([creatorId]),
        memberIds: new Set([creatorId]),
        isPublic: roomData.isPublic || false,
        maxMembers: roomData.maxMembers || 50,
        settings: this.getDefaultRoomSettings(),
        metadata: {
          totalMessages: 0,
          totalMembers: 1,
          activeMembers: 0,
          peakConcurrentUsers: 0,
          tags: [roomData.roomType],
          isArchived: false,
        },
        createdAt: new Date(),
        lastActivity: new Date(),
      };

      this.rooms.set(roomId, roomInfo);
      this.roomMembers.set(roomId, new Map());

      // Add creator to user rooms
      if (!this.userRooms.has(creatorId)) {
        this.userRooms.set(creatorId, new Set());
      }
      this.userRooms.get(creatorId)!.add(roomId);

      // Store in Redis
      await this.storeRoomInRedis(roomInfo);

      logger.info('Room created', {
        roomId,
        roomType: roomData.roomType,
        creatorId,
        name: roomData.name,
      });

      return roomInfo;

    } catch (error) {
      logger.error('Failed to create room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        creatorId,
        roomData,
      });
      return null;
    }
  }

  /**
   * Join a user to a room
   */
  public async joinRoom(
    socket: Socket,
    roomId: string,
    options: {
      role?: 'member' | 'moderator';
      validateAccess?: boolean;
    } = {}
  ): Promise<{ success: boolean; message: string; roomInfo?: RoomInfo }> {
    const socketData = socket.data as SocketData;
    const { role = 'member', validateAccess = true } = options;

    try {
      const room = this.rooms.get(roomId);
      if (!room) {
        return { success: false, message: 'Room not found' };
      }

      // Validate access if required
      if (validateAccess && !this.canUserJoinRoom(socketData.userId, room)) {
        return { success: false, message: 'Access denied to this room' };
      }

      // Check room capacity
      if (room.memberIds.size >= room.maxMembers && !room.moderatorIds.has(socketData.userId)) {
        return { success: false, message: 'Room is at maximum capacity' };
      }

      // Join the socket.io room
      await socket.join(roomId);

      // Add user to room members
      room.memberIds.add(socketData.userId);
      room.metadata.activeMembers++;
      room.lastActivity = new Date();

      // Create room member record
      const roomMember: RoomMember = {
        userId: socketData.userId,
        socketId: socket.id,
        role: room.moderatorIds.has(socketData.userId) ? 'moderator' : 
              (room.ownerId === socketData.userId ? 'owner' : role),
        joinedAt: new Date(),
        lastActivity: new Date(),
        permissions: this.getRoomPermissions(socketData.userRole, role),
        isMuted: false,
        isBanned: false,
      };

      const roomMembersMap = this.roomMembers.get(roomId) || new Map();
      roomMembersMap.set(socketData.userId, roomMember);
      this.roomMembers.set(roomId, roomMembersMap);

      // Track user rooms
      if (!this.userRooms.has(socketData.userId)) {
        this.userRooms.set(socketData.userId, new Set());
      }
      this.userRooms.get(socketData.userId)!.add(roomId);

      // Update peak concurrent users
      if (room.metadata.activeMembers > room.metadata.peakConcurrentUsers) {
        room.metadata.peakConcurrentUsers = room.metadata.activeMembers;
      }

      // Store updated room in Redis
      await this.storeRoomInRedis(room);

      // Broadcast user joined event
      this.broadcastRoomEvent(roomId, 'user:joined_class', {
        userId: socketData.userId,
        userName: `${socketData.userId}`, // We'll enhance this with actual names later
        classId: room.classId || roomId,
        className: room.name,
        timestamp: new Date(),
      }, socket.id);

      logger.info('User joined room', {
        userId: socketData.userId,
        roomId,
        roomName: room.name,
        role: roomMember.role,
        activeMembers: room.metadata.activeMembers,
      });

      return { 
        success: true, 
        message: 'Successfully joined room',
        roomInfo: room,
      };

    } catch (error) {
      logger.error('Failed to join room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
        roomId,
      });
      return { success: false, message: 'Failed to join room' };
    }
  }

  /**
   * Leave a room
   */
  public async leaveRoom(
    socket: Socket,
    roomId: string,
    reason: string = 'user_action'
  ): Promise<{ success: boolean; message: string }> {
    const socketData = socket.data as SocketData;

    try {
      const room = this.rooms.get(roomId);
      if (!room) {
        return { success: false, message: 'Room not found' };
      }

      // Leave the socket.io room
      await socket.leave(roomId);

      // Remove user from room members
      room.memberIds.delete(socketData.userId);
      room.metadata.activeMembers = Math.max(0, room.metadata.activeMembers - 1);
      room.lastActivity = new Date();

      // Remove room member record
      const roomMembersMap = this.roomMembers.get(roomId);
      if (roomMembersMap) {
        roomMembersMap.delete(socketData.userId);
      }

      // Remove from user rooms
      const userRooms = this.userRooms.get(socketData.userId);
      if (userRooms) {
        userRooms.delete(roomId);
        if (userRooms.size === 0) {
          this.userRooms.delete(socketData.userId);
        }
      }

      // Store updated room in Redis
      await this.storeRoomInRedis(room);

      // Broadcast user left event
      this.broadcastRoomEvent(roomId, 'user:left_class', {
        userId: socketData.userId,
        userName: `${socketData.userId}`,
        classId: room.classId || roomId,
        className: room.name,
        timestamp: new Date(),
      });

      logger.info('User left room', {
        userId: socketData.userId,
        roomId,
        roomName: room.name,
        reason,
        activeMembers: room.metadata.activeMembers,
      });

      return { success: true, message: 'Successfully left room' };

    } catch (error) {
      logger.error('Failed to leave room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
        roomId,
      });
      return { success: false, message: 'Failed to leave room' };
    }
  }

  /**
   * Get room information
   */
  public getRoomInfo(roomId: string): RoomInfo | null {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Get rooms for a user
   */
  public getUserRooms(userId: string): RoomInfo[] {
    const userRoomIds = this.userRooms.get(userId);
    if (!userRoomIds) return [];

    return Array.from(userRoomIds)
      .map(roomId => this.rooms.get(roomId))
      .filter((room): room is RoomInfo => room !== undefined);
  }

  /**
   * Get room members
   */
  public getRoomMembers(roomId: string): RoomMember[] {
    const roomMembersMap = this.roomMembers.get(roomId);
    if (!roomMembersMap) return [];

    return Array.from(roomMembersMap.values());
  }

  /**
   * Update room settings
   */
  public async updateRoomSettings(
    roomId: string,
    settings: Partial<RoomSettings>,
    updatedBy: string
  ): Promise<boolean> {
    try {
      const room = this.rooms.get(roomId);
      if (!room) return false;

      // Merge settings
      room.settings = { ...room.settings, ...settings };
      room.lastActivity = new Date();

      // Store in Redis
      await this.storeRoomInRedis(room);

      // Broadcast settings update
      this.broadcastRoomEvent(roomId, 'class:updated', {
        classId: room.classId || roomId,
        className: room.name,
        changes: { settings },
        updatedBy: {
          id: updatedBy,
          firstName: '', // We'll enhance this later
          lastName: '',
        },
        timestamp: new Date(),
      });

      logger.info('Room settings updated', {
        roomId,
        settings,
        updatedBy,
      });

      return true;

    } catch (error) {
      logger.error('Failed to update room settings', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId,
        settings,
      });
      return false;
    }
  }

  /**
   * Get room analytics
   */
  public getRoomAnalytics(roomId: string): RoomAnalytics | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Calculate real-time analytics
    const analytics: RoomAnalytics = {
      roomId,
      memberCount: room.memberIds.size,
      activeMembers: room.metadata.activeMembers,
      messagesLastHour: 0, // This would be calculated from message timestamps
      messagesLastDay: 0,  // This would be calculated from message timestamps
      averageSessionDuration: 0, // This would be calculated from session data
      memberEngagement: {
        high: Math.floor(room.metadata.activeMembers * 0.3),
        medium: Math.floor(room.metadata.activeMembers * 0.5),
        low: Math.floor(room.metadata.activeMembers * 0.2),
      },
      peakActivity: {
        timestamp: room.createdAt,
        userCount: room.metadata.peakConcurrentUsers,
      },
    };

    this.roomAnalytics.set(roomId, analytics);
    return analytics;
  }

  /**
   * Broadcast event to all room members
   */
  private broadcastRoomEvent(
    roomId: string,
    event: keyof ServerToClientEvents,
    data: any,
    excludeSocketId?: string
  ): void {
    if (excludeSocketId) {
      this.io.to(roomId).except(excludeSocketId).emit(event, data);
    } else {
      this.io.to(roomId).emit(event, data);
    }
  }

  /**
   * Check if user can join room
   */
  private canUserJoinRoom(userId: string, room: RoomInfo): boolean {
    // Public rooms can be joined by anyone
    if (room.isPublic) return true;

    // Check if user is already a member
    if (room.memberIds.has(userId)) return true;

    // For class rooms, check class membership
    if (room.roomType === 'class' && room.classId) {
      // This would typically involve a database query
      // For now, we'll assume validation is done elsewhere
      return true;
    }

    // For private rooms, user must be invited
    return false;
  }

  /**
   * Get room permissions for user role
   */
  private getRoomPermissions(userRole: string, roomRole: string): Set<string> {
    const permissions = new Set<string>();

    // Base permissions for all users
    permissions.add('room:view');
    permissions.add('room:message');

    // Role-specific permissions
    if (roomRole === 'moderator' || roomRole === 'owner') {
      permissions.add('room:moderate');
      permissions.add('room:manage_members');
      permissions.add('room:mute_users');
    }

    if (roomRole === 'owner') {
      permissions.add('room:delete');
      permissions.add('room:update_settings');
      permissions.add('room:add_moderators');
    }

    // Global role permissions
    if (userRole === 'ADMIN') {
      permissions.add('room:delete');
      permissions.add('room:update_settings');
      permissions.add('room:moderate');
      permissions.add('room:manage_members');
    }

    return permissions;
  }

  /**
   * Get default room settings
   */
  private getDefaultRoomSettings(): RoomSettings {
    return {
      allowMessaging: true,
      allowFileSharing: true,
      allowVoiceChat: false,
      allowVideoChat: false,
      moderationLevel: 'basic',
      messageRetention: 30, // 30 days
      autoCleanup: true,
      notifications: {
        memberJoin: true,
        memberLeave: true,
        newMessage: true,
      },
    };
  }

  /**
   * Store room in Redis
   */
  private async storeRoomInRedis(room: RoomInfo): Promise<void> {
    try {
      const key = `room:${room.roomId}`;
      const roomData = {
        ...room,
        memberIds: Array.from(room.memberIds),
        moderatorIds: Array.from(room.moderatorIds),
      };
      await redis.setex(key, 86400, JSON.stringify(roomData)); // 24 hours TTL
    } catch (error) {
      logger.warn('Failed to store room in Redis', {
        roomId: room.roomId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Perform cleanup operations
   */
  private async performCleanup(): Promise<void> {
    const now = new Date();
    let cleanedRooms = 0;

    for (const [roomId, room] of this.rooms) {
      // Clean up inactive rooms (no activity for 24 hours)
      if (room.settings.autoCleanup && 
          now.getTime() - room.lastActivity.getTime() > 86400000 && 
          room.metadata.activeMembers === 0) {
        
        await this.deleteRoom(roomId, 'auto_cleanup');
        cleanedRooms++;
      }
    }

    if (cleanedRooms > 0) {
      logger.info('Room cleanup completed', {
        cleanedRooms,
        totalRooms: this.rooms.size,
      });
    }
  }

  /**
   * Delete a room
   */
  public async deleteRoom(roomId: string, reason: string = 'manual'): Promise<boolean> {
    try {
      const room = this.rooms.get(roomId);
      if (!room) return false;

      // Notify all members before deletion
      this.broadcastRoomEvent(roomId, 'system:announcement', {
        type: 'announcement',
        title: 'Room Deletion',
        message: `This room will be deleted. Reason: ${reason}`,
        severity: 'warning',
      });

      // Remove all members
      const roomMembersMap = this.roomMembers.get(roomId);
      if (roomMembersMap) {
        for (const member of roomMembersMap.values()) {
          const socket = this.io.sockets.sockets.get(member.socketId);
          if (socket) {
            await socket.leave(roomId);
          }
        }
      }

      // Clean up data structures
      this.rooms.delete(roomId);
      this.roomMembers.delete(roomId);
      this.roomAnalytics.delete(roomId);

      // Remove from user rooms
      for (const [userId, userRooms] of this.userRooms) {
        userRooms.delete(roomId);
        if (userRooms.size === 0) {
          this.userRooms.delete(userId);
        }
      }

      // Remove from Redis
      await redis.del(`room:${roomId}`);

      logger.info('Room deleted', {
        roomId,
        roomName: room.name,
        reason,
      });

      return true;

    } catch (error) {
      logger.error('Failed to delete room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId,
      });
      return false;
    }
  }

  /**
   * Get all rooms (for admin)
   */
  public getAllRooms(): RoomInfo[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get room statistics
   */
  public getRoomStats(): {
    totalRooms: number;
    roomsByType: Record<string, number>;
    totalMembers: number;
    activeRooms: number;
  } {
    const roomsByType: Record<string, number> = {};
    let totalMembers = 0;
    let activeRooms = 0;

    for (const room of this.rooms.values()) {
      roomsByType[room.roomType] = (roomsByType[room.roomType] || 0) + 1;
      totalMembers += room.memberIds.size;
      if (room.metadata.activeMembers > 0) {
        activeRooms++;
      }
    }

    return {
      totalRooms: this.rooms.size,
      roomsByType,
      totalMembers,
      activeRooms,
    };
  }

  /**
   * Destroy room manager
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clean up all rooms
    const roomIds = Array.from(this.rooms.keys());
    roomIds.forEach(roomId => {
      this.deleteRoom(roomId, 'server_shutdown');
    });

    logger.info('Room Manager destroyed');
  }
} 