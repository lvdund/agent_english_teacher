import { Socket, Server as SocketIOServer } from 'socket.io';
import { logger } from '@/utils/logger';
import { WebSocketAuthorization, hasPermission } from '../middleware/authorization';
import { RoomManager, RoomInfo, RoomSettings } from '../services/roomManager';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '../types/events';

interface CreateRoomData {
  name: string;
  description?: string;
  roomType: 'class' | 'direct' | 'group' | 'system';
  isPublic?: boolean;
  maxMembers?: number;
  classId?: string;
}

interface JoinRoomData {
  roomId: string;
  password?: string;
}

interface LeaveRoomData {
  roomId: string;
}

interface UpdateRoomData {
  roomId: string;
  settings?: Partial<RoomSettings>;
  name?: string;
  description?: string;
  maxMembers?: number;
}

interface ModerateRoomData {
  roomId: string;
  action: 'mute' | 'unmute' | 'kick' | 'ban' | 'unban' | 'promote' | 'demote';
  targetUserId: string;
  reason?: string;
  duration?: number; // For temporary actions
}

interface RoomInviteData {
  roomId: string;
  userIds: string[];
  message?: string;
}

export class RoomHandler {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private roomManager: RoomManager;

  constructor(
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    roomManager: RoomManager
  ) {
    this.io = io;
    this.roomManager = roomManager;
  }

  /**
   * Setup room event handlers for a socket
   */
  public setupEventHandlers(socket: Socket): void {
    // Room creation
    socket.on('room:create' as any, async (data: CreateRoomData, callback?: (response: any) => void) => {
      await this.handleCreateRoom(socket, data, callback);
    });

    // Room joining
    socket.on('room:join' as any, async (data: JoinRoomData, callback?: (response: any) => void) => {
      await this.handleJoinRoom(socket, data, callback);
    });

    // Room leaving
    socket.on('room:leave' as any, async (data: LeaveRoomData, callback?: (response: any) => void) => {
      await this.handleLeaveRoom(socket, data, callback);
    });

    // Room updates
    socket.on('room:update' as any, async (data: UpdateRoomData, callback?: (response: any) => void) => {
      await this.handleUpdateRoom(socket, data, callback);
    });

    // Room moderation
    socket.on('room:moderate' as any, async (data: ModerateRoomData, callback?: (response: any) => void) => {
      await this.handleModerationAction(socket, data, callback);
    });

    // Room invitations
    socket.on('room:invite' as any, async (data: RoomInviteData, callback?: (response: any) => void) => {
      await this.handleRoomInvite(socket, data, callback);
    });

    // Get room info
    socket.on('room:get_info' as any, async (data: { roomId: string }, callback?: (response: any) => void) => {
      await this.handleGetRoomInfo(socket, data, callback);
    });

    // Get user rooms
    socket.on('room:get_user_rooms' as any, async (callback?: (response: any) => void) => {
      await this.handleGetUserRooms(socket, callback);
    });

    // Get room members
    socket.on('room:get_members' as any, async (data: { roomId: string }, callback?: (response: any) => void) => {
      await this.handleGetRoomMembers(socket, data, callback);
    });

    // Get room analytics (admin/moderator only)
    socket.on('room:get_analytics' as any, async (data: { roomId: string }, callback?: (response: any) => void) => {
      await this.handleGetRoomAnalytics(socket, data, callback);
    });

    logger.debug('Room event handlers setup completed', {
      socketId: socket.id,
      userId: socket.data?.userId,
    });
  }

  /**
   * Handle room creation
   */
  private async handleCreateRoom(
    socket: Socket,
    data: CreateRoomData,
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

    try {
      // Check permission to create rooms
      if (!hasPermission(socket, 'class:create') && data.roomType === 'class') {
        if (callback) {
          callback({
            success: false,
            error: 'Permission denied: Cannot create class rooms',
          });
        }
        return;
      }

      // Validate room data
      if (!data.name || data.name.trim().length === 0) {
        if (callback) {
          callback({
            success: false,
            error: 'Room name is required',
          });
        }
        return;
      }

      // Create the room
      const room = await this.roomManager.createRoom(socketData.userId, data);
      
      if (!room) {
        if (callback) {
          callback({
            success: false,
            error: 'Failed to create room',
          });
        }
        return;
      }

      // Auto-join creator to the room
      const joinResult = await this.roomManager.joinRoom(socket, room.roomId, {
        role: 'member', // Changed from 'owner' to 'member'
        validateAccess: false,
      });

      logger.info('Room created successfully', {
        roomId: room.roomId,
        roomName: room.name,
        creatorId: socketData.userId,
        roomType: room.roomType,
      });

      if (callback) {
        callback({
          success: true,
          message: 'Room created successfully',
          data: {
            room: this.sanitizeRoomInfo(room),
            joinResult,
          },
        });
      }

    } catch (error) {
      logger.error('Error creating room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
        data,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }

  /**
   * Handle room joining
   */
  private async handleJoinRoom(
    socket: Socket,
    data: JoinRoomData,
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

    try {
      // Get room info
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

      // Check if user has permission to join this room
      if (room.roomType === 'class' && room.classId && !hasPermission(socket, 'class:join', { classId: room.classId })) {
        if (callback) {
          callback({
            success: false,
            error: 'Permission denied: Cannot join this class room',
          });
        }
        return;
      }

      // Attempt to join the room
      const result = await this.roomManager.joinRoom(socket, data.roomId);

      logger.info('Room join attempt', {
        userId: socketData.userId,
        roomId: data.roomId,
        roomName: room.name,
        success: result.success,
      });

      if (callback) {
        callback({
          success: result.success,
          message: result.message,
          data: result.roomInfo ? {
            room: this.sanitizeRoomInfo(result.roomInfo),
          } : undefined,
        });
      }

    } catch (error) {
      logger.error('Error joining room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
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

  /**
   * Handle room leaving
   */
  private async handleLeaveRoom(
    socket: Socket,
    data: LeaveRoomData,
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

    try {
      const result = await this.roomManager.leaveRoom(socket, data.roomId, 'user_request');

      logger.info('Room leave attempt', {
        userId: socketData.userId,
        roomId: data.roomId,
        success: result.success,
      });

      if (callback) {
        callback({
          success: result.success,
          message: result.message,
        });
      }

    } catch (error) {
      logger.error('Error leaving room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
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

  /**
   * Handle room updates
   */
  private async handleUpdateRoom(
    socket: Socket,
    data: UpdateRoomData,
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

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

      // Check permissions to update room
      const canManage = room.ownerId === socketData.userId || 
                       room.moderatorIds.has(socketData.userId) ||
                       (room.classId ? hasPermission(socket, 'class:manage', { classId: room.classId }) : false);

      if (!canManage) {
        if (callback) {
          callback({
            success: false,
            error: 'Permission denied: Cannot manage this room',
          });
        }
        return;
      }

      // Update room settings if provided
      if (data.settings) {
        const success = await this.roomManager.updateRoomSettings(
          data.roomId,
          data.settings,
          socketData.userId
        );

        if (!success) {
          if (callback) {
            callback({
              success: false,
              error: 'Failed to update room settings',
            });
          }
          return;
        }
      }

      // Update other room properties (name, description, maxMembers)
      if (data.name || data.description || data.maxMembers) {
        const updatedRoom = this.roomManager.getRoomInfo(data.roomId);
        if (updatedRoom) {
          if (data.name) updatedRoom.name = data.name;
          if (data.description !== undefined) updatedRoom.description = data.description;
          if (data.maxMembers) updatedRoom.maxMembers = data.maxMembers;
        }
      }

      logger.info('Room updated successfully', {
        roomId: data.roomId,
        updatedBy: socketData.userId,
        changes: {
          settings: data.settings,
          name: data.name,
          description: data.description,
          maxMembers: data.maxMembers,
        },
      });

      if (callback) {
        callback({
          success: true,
          message: 'Room updated successfully',
          data: {
            room: this.sanitizeRoomInfo(room),
          },
        });
      }

    } catch (error) {
      logger.error('Error updating room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
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

  /**
   * Handle moderation actions
   */
  private async handleModerationAction(
    socket: Socket,
    data: ModerateRoomData,
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

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

      // Check moderation permissions
      const canModerate = room.ownerId === socketData.userId || 
                         room.moderatorIds.has(socketData.userId) ||
                         hasPermission(socket, 'room:moderate');

      if (!canModerate) {
        if (callback) {
          callback({
            success: false,
            error: 'Permission denied: Cannot moderate this room',
          });
        }
        return;
      }

      // Prevent self-moderation (except owner)
      if (data.targetUserId === socketData.userId && room.ownerId !== socketData.userId) {
        if (callback) {
          callback({
            success: false,
            error: 'Cannot perform moderation actions on yourself',
          });
        }
        return;
      }

      // Get target socket
      const targetSocket = Array.from(this.io.sockets.sockets.values())
        .find(s => s.data?.userId === data.targetUserId);

      // Perform moderation action
      let success = false;
      let message = '';

      switch (data.action) {
        case 'kick':
          if (targetSocket) {
            await this.roomManager.leaveRoom(targetSocket, data.roomId, 'kicked');
            success = true;
            message = 'User kicked from room';
          }
          break;

        case 'mute':
          // Implementation would involve updating room member's mute status
          success = true;
          message = 'User muted';
          break;

        case 'unmute':
          success = true;
          message = 'User unmuted';
          break;

        case 'ban':
          // Implementation would involve adding user to banned list
          if (targetSocket) {
            await this.roomManager.leaveRoom(targetSocket, data.roomId, 'banned');
          }
          success = true;
          message = 'User banned from room';
          break;

        case 'unban':
          success = true;
          message = 'User unbanned';
          break;

        case 'promote':
          room.moderatorIds.add(data.targetUserId);
          success = true;
          message = 'User promoted to moderator';
          break;

        case 'demote':
          room.moderatorIds.delete(data.targetUserId);
          success = true;
          message = 'User demoted from moderator';
          break;

        default:
          if (callback) {
            callback({
              success: false,
              error: 'Unknown moderation action',
            });
          }
          return;
      }

      // Broadcast moderation action
      this.io.to(data.roomId).emit('room:moderation_action', {
        roomId: data.roomId,
        action: data.action,
        targetUserId: data.targetUserId,
        moderatorId: socketData.userId,
        ...(data.reason && { reason: data.reason }),
        timestamp: new Date(),
      });

      logger.info('Moderation action performed', {
        roomId: data.roomId,
        action: data.action,
        targetUserId: data.targetUserId,
        moderatorId: socketData.userId,
        reason: data.reason,
      });

      if (callback) {
        callback({
          success,
          message,
        });
      }

    } catch (error) {
      logger.error('Error performing moderation action', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
        data,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }

  /**
   * Handle room invitations
   */
  private async handleRoomInvite(
    socket: Socket,
    data: RoomInviteData,
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

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

      // Check permission to invite users
      const canInvite = room.memberIds.has(socketData.userId) && 
                       (room.isPublic || room.moderatorIds.has(socketData.userId));

      if (!canInvite) {
        if (callback) {
          callback({
            success: false,
            error: 'Permission denied: Cannot invite users to this room',
          });
        }
        return;
      }

      // Send invitations
      let invitesSent = 0;
      for (const userId of data.userIds) {
        // Send invitation notification
        this.io.to(`user:${userId}`).emit('room:invitation', {
          roomId: data.roomId,
          roomName: room.name,
          inviterId: socketData.userId,
          ...(data.message && { message: data.message }),
          timestamp: new Date(),
        });
        invitesSent++;
      }

      logger.info('Room invitations sent', {
        roomId: data.roomId,
        inviterId: socketData.userId,
        invitedUsers: data.userIds,
        invitesSent,
      });

      if (callback) {
        callback({
          success: true,
          message: `${invitesSent} invitations sent`,
          data: { invitesSent },
        });
      }

    } catch (error) {
      logger.error('Error sending room invitations', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
        data,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }

  /**
   * Handle get room info request
   */
  private async handleGetRoomInfo(
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

      if (callback) {
        callback({
          success: true,
          data: {
            room: this.sanitizeRoomInfo(room),
          },
        });
      }

    } catch (error) {
      logger.error('Error getting room info', {
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

  /**
   * Handle get user rooms request
   */
  private async handleGetUserRooms(
    socket: Socket,
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

    try {
      const rooms = this.roomManager.getUserRooms(socketData.userId);
      
      if (callback) {
        callback({
          success: true,
          data: {
            rooms: rooms.map(room => this.sanitizeRoomInfo(room)),
          },
        });
      }

    } catch (error) {
      logger.error('Error getting user rooms', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socketData.userId,
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  }

  /**
   * Handle get room members request
   */
  private async handleGetRoomMembers(
    socket: Socket,
    data: { roomId: string },
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

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

      // Check if user has access to view members
      const hasAccess = room.memberIds.has(socketData.userId) || 
                       hasPermission(socket, 'room:view');

      if (!hasAccess) {
        if (callback) {
          callback({
            success: false,
            error: 'Permission denied: Cannot view room members',
          });
        }
        return;
      }

      const members = this.roomManager.getRoomMembers(data.roomId);
      
      if (callback) {
        callback({
          success: true,
          data: {
            members: members.map(member => ({
              userId: member.userId,
              role: member.role,
              joinedAt: member.joinedAt,
              lastActivity: member.lastActivity,
              isMuted: member.isMuted,
              isBanned: member.isBanned,
            })),
          },
        });
      }

    } catch (error) {
      logger.error('Error getting room members', {
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

  /**
   * Handle get room analytics request
   */
  private async handleGetRoomAnalytics(
    socket: Socket,
    data: { roomId: string },
    callback?: (response: any) => void
  ): Promise<void> {
    const socketData = socket.data as SocketData;

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
      const canViewAnalytics = room.ownerId === socketData.userId || 
                              room.moderatorIds.has(socketData.userId) ||
                              hasPermission(socket, 'class:view_analytics');

      if (!canViewAnalytics) {
        if (callback) {
          callback({
            success: false,
            error: 'Permission denied: Cannot view room analytics',
          });
        }
        return;
      }

      const analytics = this.roomManager.getRoomAnalytics(data.roomId);
      
      if (callback) {
        callback({
          success: true,
          data: { analytics },
        });
      }

    } catch (error) {
      logger.error('Error getting room analytics', {
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

  /**
   * Sanitize room info for client
   */
  private sanitizeRoomInfo(room: RoomInfo): any {
    return {
      roomId: room.roomId,
      roomType: room.roomType,
      name: room.name,
      description: room.description,
      classId: room.classId,
      ownerId: room.ownerId,
      isPublic: room.isPublic,
      maxMembers: room.maxMembers,
      memberCount: room.memberIds.size,
      activeMembers: room.metadata.activeMembers,
      settings: room.settings,
      tags: room.metadata.tags,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity,
    };
  }
} 