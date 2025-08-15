import { Socket } from 'socket.io';
import { logger } from '@/utils/logger';
import { RoomManager, RoomMember } from '../services/roomManager';
import { WebSocketAuthorization } from './authorization';
import type { SocketData } from '../types/events';

export interface RoomPermissionContext {
  roomId: string;
  action: string;
  targetUserId?: string;
  resourceId?: string;
}

export interface ModerationAction {
  type: 'mute' | 'unmute' | 'kick' | 'ban' | 'unban' | 'warn' | 'timeout';
  roomId: string;
  targetUserId: string;
  moderatorId: string;
  reason?: string;
  duration?: number; // in minutes, for temporary actions
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface RoomModerationConfig {
  autoModeration: boolean;
  spamThreshold: number;
  warningThreshold: number;
  muteDuration: number; // default mute duration in minutes
  banDuration: number; // default ban duration in minutes
  allowedFileTypes: string[];
  maxFileSize: number; // in bytes
  maxMessageLength: number;
  cooldownPeriod: number; // message cooldown in seconds
}

export class RoomPermissionManager {
  private roomManager: RoomManager;
  private moderationHistory: Map<string, ModerationAction[]> = new Map(); // roomId -> actions
  private userWarnings: Map<string, Map<string, number>> = new Map(); // roomId -> userId -> warning count
  private userCooldowns: Map<string, Map<string, Date>> = new Map(); // roomId -> userId -> last message time
  private mutedUsers: Map<string, Map<string, Date>> = new Map(); // roomId -> userId -> mute expiry
  private bannedUsers: Map<string, Map<string, Date>> = new Map(); // roomId -> userId -> ban expiry

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
    this.setupCleanupInterval();
  }

  /**
   * Check if user has specific room permission
   */
  public hasRoomPermission(
    socket: Socket,
    context: RoomPermissionContext
  ): { allowed: boolean; reason?: string } {
    const socketData = socket.data as SocketData;
    const { roomId, action, targetUserId } = context;

    // Get room info
    const room = this.roomManager.getRoomInfo(roomId);
    if (!room) {
      return { allowed: false, reason: 'Room not found' };
    }

    // Check if user is a member of the room
    if (!room.memberIds.has(socketData.userId)) {
      return { allowed: false, reason: 'Not a member of this room' };
    }

    // Check if user is banned
    if (this.isUserBanned(roomId, socketData.userId)) {
      return { allowed: false, reason: 'User is banned from this room' };
    }

    // Check if user is muted for certain actions
    if (this.isUserMuted(roomId, socketData.userId) && this.isMutedAction(action)) {
      return { allowed: false, reason: 'User is muted in this room' };
    }

    // Get room member info
    const roomMembers = this.roomManager.getRoomMembers(roomId);
    const userMember = roomMembers.find(m => m.userId === socketData.userId);

    if (!userMember) {
      return { allowed: false, reason: 'User not found in room members' };
    }

    // Check permission based on action
    return this.checkActionPermission(socketData, userMember, room, action, targetUserId);
  }

  /**
   * Check permission for specific actions
   */
  private checkActionPermission(
    socketData: SocketData,
    userMember: RoomMember,
    room: any,
    action: string,
    targetUserId?: string
  ): { allowed: boolean; reason?: string } {
    const isOwner = room.ownerId === socketData.userId;
    const isModerator = room.moderatorIds.has(socketData.userId);
    const isAdmin = socketData.userRole === 'ADMIN';

    switch (action) {
      case 'message:send':
        if (room.settings && !room.settings.allowMessaging) {
          return { allowed: false, reason: 'Messaging is disabled in this room' };
        }
        return { allowed: true };

      case 'file:upload':
        if (room.settings && !room.settings.allowFileSharing) {
          return { allowed: false, reason: 'File sharing is disabled in this room' };
        }
        return { allowed: true };

      case 'voice:join':
        if (room.settings && !room.settings.allowVoiceChat) {
          return { allowed: false, reason: 'Voice chat is disabled in this room' };
        }
        return { allowed: true };

      case 'video:join':
        if (room.settings && !room.settings.allowVideoChat) {
          return { allowed: false, reason: 'Video chat is disabled in this room' };
        }
        return { allowed: true };

      case 'member:mute':
      case 'member:unmute':
      case 'member:warn':
      case 'member:kick':
        if (isAdmin || isOwner || isModerator) {
          // Prevent self-action (except for unmute)
          if (targetUserId === socketData.userId && action !== 'member:unmute') {
            return { allowed: false, reason: 'Cannot perform this action on yourself' };
          }
          // Prevent action on higher-ranked users
          if (targetUserId && this.isTargetHigherRank(socketData.userId, targetUserId, room)) {
            return { allowed: false, reason: 'Cannot moderate users with higher privileges' };
          }
          return { allowed: true };
        }
        return { allowed: false, reason: 'Moderator privileges required' };

      case 'member:ban':
      case 'member:unban':
        if (isAdmin || isOwner) {
          if (targetUserId && this.isTargetHigherRank(socketData.userId, targetUserId, room)) {
            return { allowed: false, reason: 'Cannot ban users with higher privileges' };
          }
          return { allowed: true };
        }
        return { allowed: false, reason: 'Owner privileges required' };

      case 'member:promote':
      case 'member:demote':
        if (isAdmin || isOwner) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Owner privileges required' };

      case 'room:update_settings':
      case 'room:delete':
        if (isAdmin || isOwner) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Owner privileges required' };

      case 'room:invite':
        if (room.isPublic || isAdmin || isOwner || isModerator) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Invitation privileges required' };

      case 'analytics:view':
        if (isAdmin || isOwner || isModerator) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Analytics access requires moderation privileges' };

      default:
        // Default to allowing basic room interactions
        return { allowed: true };
    }
  }

  /**
   * Check if target user has higher rank than actor
   */
  private isTargetHigherRank(actorId: string, targetId: string, room: any): boolean {
    const isActorOwner = room.ownerId === actorId;
    const isActorModerator = room.moderatorIds.has(actorId);
    const isTargetOwner = room.ownerId === targetId;
    const isTargetModerator = room.moderatorIds.has(targetId);

    // Owner cannot be outranked
    if (isTargetOwner) return !isActorOwner;
    
    // Moderator can only be outranked by owner
    if (isTargetModerator) return !isActorOwner && !isActorModerator;
    
    return false;
  }

  /**
   * Apply moderation action
   */
  public async applyModerationAction(
    moderatorId: string,
    action: Omit<ModerationAction, 'moderatorId' | 'timestamp'>
  ): Promise<{ success: boolean; message: string }> {
    const { type, roomId, targetUserId, reason, duration } = action;

    try {
      const room = this.roomManager.getRoomInfo(roomId);
      if (!room) {
        return { success: false, message: 'Room not found' };
      }

      const moderationAction: ModerationAction = {
        ...action,
        moderatorId,
        timestamp: new Date(),
      };

      // Apply the action
      let success = false;
      let message = '';

      switch (type) {
        case 'mute':
          const muteExpiry = duration ? 
            new Date(Date.now() + duration * 60000) : 
            new Date(Date.now() + 30 * 60000); // Default 30 minutes
          
          this.setUserMuted(roomId, targetUserId, muteExpiry);
          success = true;
          message = `User muted until ${muteExpiry.toLocaleTimeString()}`;
          break;

        case 'unmute':
          this.removeUserMuted(roomId, targetUserId);
          success = true;
          message = 'User unmuted';
          break;

        case 'ban':
          const banExpiry = duration ? 
            new Date(Date.now() + duration * 60000) : 
            new Date(Date.now() + 24 * 60 * 60000); // Default 24 hours
          
          this.setUserBanned(roomId, targetUserId, banExpiry);
          success = true;
          message = `User banned until ${banExpiry.toLocaleString()}`;
          break;

        case 'unban':
          this.removeUserBanned(roomId, targetUserId);
          success = true;
          message = 'User unbanned';
          break;

        case 'warn':
          this.addUserWarning(roomId, targetUserId);
          const warningCount = this.getUserWarnings(roomId, targetUserId);
          success = true;
          message = `User warned (${warningCount} warnings)`;
          
          // Auto-mute after 3 warnings
          if (warningCount >= 3) {
            this.setUserMuted(roomId, targetUserId, new Date(Date.now() + 10 * 60000)); // 10 minutes
            message += ' - Auto-muted for repeated warnings';
          }
          break;

        case 'timeout':
          const timeoutDuration = duration || 5; // Default 5 minutes
          this.setUserMuted(roomId, targetUserId, new Date(Date.now() + timeoutDuration * 60000));
          success = true;
          message = `User timed out for ${timeoutDuration} minutes`;
          break;

        case 'kick':
          // This would be handled by the room manager
          success = true;
          message = 'User kicked from room';
          break;

        default:
          return { success: false, message: 'Unknown moderation action' };
      }

      // Record the moderation action
      if (success) {
        this.recordModerationAction(moderationAction);
        
        logger.info('Moderation action applied', {
          roomId,
          type,
          targetUserId,
          moderatorId,
          reason,
          duration,
        });
      }

      return { success, message };

    } catch (error) {
      logger.error('Failed to apply moderation action', {
        error: error instanceof Error ? error.message : 'Unknown error',
        action,
      });
      return { success: false, message: 'Failed to apply moderation action' };
    }
  }

  /**
   * Check message content for auto-moderation
   */
  public checkMessageContent(
    roomId: string,
    userId: string,
    content: string,
    config: RoomModerationConfig
  ): { allowed: boolean; reason?: string; autoAction?: ModerationAction } {
    // Check message length
    if (content.length > config.maxMessageLength) {
      return { 
        allowed: false, 
        reason: `Message too long (max ${config.maxMessageLength} characters)` 
      };
    }

    // Check cooldown period
    if (this.isUserInCooldown(roomId, userId, config.cooldownPeriod)) {
      return { 
        allowed: false, 
        reason: `Please wait ${config.cooldownPeriod} seconds between messages` 
      };
    }

    // Simple spam detection
    if (this.detectSpam(roomId, userId, content, config.spamThreshold)) {
      const autoAction: ModerationAction = {
        type: 'mute',
        roomId,
        targetUserId: userId,
        moderatorId: 'system',
        reason: 'Auto-moderation: Spam detected',
        duration: 5, // 5 minutes
        timestamp: new Date(),
      };

      return { 
        allowed: false, 
        reason: 'Spam detected - auto-muted',
        autoAction 
      };
    }

    // Update cooldown
    this.updateUserCooldown(roomId, userId);

    return { allowed: true };
  }

  /**
   * User state management methods
   */
  private isUserMuted(roomId: string, userId: string): boolean {
    const roomMuted = this.mutedUsers.get(roomId);
    if (!roomMuted) return false;

    const muteExpiry = roomMuted.get(userId);
    if (!muteExpiry) return false;

    if (new Date() > muteExpiry) {
      roomMuted.delete(userId);
      return false;
    }

    return true;
  }

  private isUserBanned(roomId: string, userId: string): boolean {
    const roomBanned = this.bannedUsers.get(roomId);
    if (!roomBanned) return false;

    const banExpiry = roomBanned.get(userId);
    if (!banExpiry) return false;

    if (new Date() > banExpiry) {
      roomBanned.delete(userId);
      return false;
    }

    return true;
  }

  private setUserMuted(roomId: string, userId: string, expiry: Date): void {
    if (!this.mutedUsers.has(roomId)) {
      this.mutedUsers.set(roomId, new Map());
    }
    this.mutedUsers.get(roomId)!.set(userId, expiry);
  }

  private removeUserMuted(roomId: string, userId: string): void {
    const roomMuted = this.mutedUsers.get(roomId);
    if (roomMuted) {
      roomMuted.delete(userId);
    }
  }

  private setUserBanned(roomId: string, userId: string, expiry: Date): void {
    if (!this.bannedUsers.has(roomId)) {
      this.bannedUsers.set(roomId, new Map());
    }
    this.bannedUsers.get(roomId)!.set(userId, expiry);
  }

  private removeUserBanned(roomId: string, userId: string): void {
    const roomBanned = this.bannedUsers.get(roomId);
    if (roomBanned) {
      roomBanned.delete(userId);
    }
  }

  private addUserWarning(roomId: string, userId: string): void {
    if (!this.userWarnings.has(roomId)) {
      this.userWarnings.set(roomId, new Map());
    }
    const roomWarnings = this.userWarnings.get(roomId)!;
    const currentWarnings = roomWarnings.get(userId) || 0;
    roomWarnings.set(userId, currentWarnings + 1);
  }

  private getUserWarnings(roomId: string, userId: string): number {
    const roomWarnings = this.userWarnings.get(roomId);
    return roomWarnings?.get(userId) || 0;
  }

  private isUserInCooldown(roomId: string, userId: string, cooldownSeconds: number): boolean {
    const roomCooldowns = this.userCooldowns.get(roomId);
    if (!roomCooldowns) return false;

    const lastMessage = roomCooldowns.get(userId);
    if (!lastMessage) return false;

    const timeDiff = (Date.now() - lastMessage.getTime()) / 1000;
    return timeDiff < cooldownSeconds;
  }

  private updateUserCooldown(roomId: string, userId: string): void {
    if (!this.userCooldowns.has(roomId)) {
      this.userCooldowns.set(roomId, new Map());
    }
    this.userCooldowns.get(roomId)!.set(userId, new Date());
  }

  private detectSpam(roomId: string, userId: string, content: string, threshold: number): boolean {
    // Simple spam detection based on message frequency and similarity
    // In a real implementation, this would be more sophisticated
    return false; // Placeholder
  }

  private isMutedAction(action: string): boolean {
    return [
      'message:send',
      'voice:join',
      'video:join',
      'file:upload'
    ].includes(action);
  }

  private recordModerationAction(action: ModerationAction): void {
    if (!this.moderationHistory.has(action.roomId)) {
      this.moderationHistory.set(action.roomId, []);
    }
    this.moderationHistory.get(action.roomId)!.push(action);
  }

  /**
   * Get moderation history for a room
   */
  public getModerationHistory(roomId: string, limit: number = 50): ModerationAction[] {
    const history = this.moderationHistory.get(roomId) || [];
    return history.slice(-limit);
  }

  /**
   * Get user's moderation status
   */
  public getUserModerationStatus(roomId: string, userId: string): {
    isMuted: boolean;
    muteExpiry?: Date;
    isBanned: boolean;
    banExpiry?: Date;
    warnings: number;
    inCooldown: boolean;
  } {
    const roomMuted = this.mutedUsers.get(roomId);
    const roomBanned = this.bannedUsers.get(roomId);
    const muteExpiry = roomMuted?.get(userId);
    const banExpiry = roomBanned?.get(userId);

    const result: {
      isMuted: boolean;
      muteExpiry?: Date;
      isBanned: boolean;
      banExpiry?: Date;
      warnings: number;
      inCooldown: boolean;
    } = {
      isMuted: this.isUserMuted(roomId, userId),
      isBanned: this.isUserBanned(roomId, userId),
      warnings: this.getUserWarnings(roomId, userId),
      inCooldown: this.isUserInCooldown(roomId, userId, 5), // 5 second default cooldown check
    };

    if (muteExpiry) {
      result.muteExpiry = muteExpiry;
    }
    if (banExpiry) {
      result.banExpiry = banExpiry;
    }

    return result;
  }

  /**
   * Setup cleanup interval for expired mutes/bans
   */
  private setupCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpiredActions();
    }, 60000); // Run every minute
  }

  private cleanupExpiredActions(): void {
    const now = new Date();

    // Clean up expired mutes
    for (const [roomId, roomMuted] of this.mutedUsers) {
      for (const [userId, expiry] of roomMuted) {
        if (now > expiry) {
          roomMuted.delete(userId);
        }
      }
    }

    // Clean up expired bans
    for (const [roomId, roomBanned] of this.bannedUsers) {
      for (const [userId, expiry] of roomBanned) {
        if (now > expiry) {
          roomBanned.delete(userId);
        }
      }
    }
  }

  /**
   * Middleware factory for room permission checking
   */
  public requireRoomPermission(context: Omit<RoomPermissionContext, 'roomId'>) {
    return (socket: Socket, roomId: string, next: (err?: Error) => void) => {
      const fullContext: RoomPermissionContext = { ...context, roomId };
      const result = this.hasRoomPermission(socket, fullContext);
      
      if (result.allowed) {
        next();
      } else {
        logger.warn('Room permission denied', {
          userId: socket.data?.userId,
          roomId,
          action: context.action,
          reason: result.reason,
        });
        next(new Error(result.reason || 'Permission denied'));
      }
    };
  }
} 