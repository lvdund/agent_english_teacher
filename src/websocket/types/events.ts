// WebSocket Event Types for Real-time Communication

export interface ServerToClientEvents {
  // System events
  'system:maintenance': (data: {
    type: 'maintenance' | 'announcement' | 'warning';
    title: string;
    message: string;
    severity?: 'info' | 'warning' | 'error';
  }) => void;

  'system:announcement': (data: {
    type: 'announcement' | 'notification';
    title: string;
    message: string;
    severity?: 'info' | 'warning' | 'error';
  }) => void;

  // Authentication events
  'auth:error': (data: AuthErrorEventData) => void;

  // Message events
  'message:new': (data: MessageEventData) => void;
  'message:updated': (data: MessageEventData) => void;
  'message:deleted': (data: { messageId: string; deletedBy: string; timestamp: Date }) => void;

  // Typing events
  'user:typing': (data: TypingEventData) => void;
  'user:stop_typing': (data: TypingEventData) => void;

  // Presence events
  'user:online': (data: PresenceEventData) => void;
  'user:offline': (data: PresenceEventData) => void;

  // Class events
  'user:joined_class': (data: ClassJoinEventData) => void;
  'user:left_class': (data: ClassLeaveEventData) => void;
  'class:updated': (data: ClassUpdatedEventData) => void;

  // User events
  'user:rooms_updated': (data: {
    rooms: Array<{
      roomId: string;
      name: string;
      roomType: string;
      memberCount: number;
      isActive: boolean;
    }>;
    timestamp: Date;
  }) => void;

  // Room events
  'room:metrics_update': (data: {
    roomId: string;
    metrics: {
      activeUsers: number;
      messagesPerHour: number;
      userEngagement: {
        veryActive: number;
        active: number;
        passive: number;
        lurkers: number;
      };
    };
    timestamp: Date;
  }) => void;

  'room:moderation_action': (data: {
    roomId: string;
    action: string;
    targetUserId: string;
    moderatorId: string;
    reason?: string;
    timestamp: Date;
  }) => void;

  'room:invitation': (data: {
    roomId: string;
    roomName: string;
    inviterId: string;
    message?: string;
    timestamp: Date;
  }) => void;

  // Notification events
  'notification:new': (data: NotificationEventData) => void;

  // Rate limiting events
  'rate_limit:exceeded': (data: RateLimitEventData) => void;

  // Generic error event
  'error': (data: { message: string; code?: string }) => void;
}

export interface ClientToServerEvents {
  // Connection Events
  'join:class': (data: JoinClassData, callback?: (response: AckResponse) => void) => void;
  'leave:class': (data: LeaveClassData, callback?: (response: AckResponse) => void) => void;
  
  // Message Events
  'message:send': (data: SendMessageData, callback?: (response: MessageAckResponse) => void) => void;
  'message:edit': (data: EditMessageData, callback?: (response: AckResponse) => void) => void;
  'message:delete': (data: DeleteMessageData, callback?: (response: AckResponse) => void) => void;
  
  // Typing Events
  'typing:start': (data: StartTypingData) => void;
  'typing:stop': (data: StopTypingData) => void;
  
  // Presence Events
  'presence:update': (data: PresenceUpdateData) => void;
  
  // Notification Events
  'notification:mark_read': (data: MarkNotificationReadData) => void;
  'notification:mark_all_read': (data: MarkAllNotificationsReadData) => void;
}

export interface InterServerEvents {
  // For scaling across multiple server instances
  'broadcast:to_class': (classId: string, event: string, data: any) => void;
  'broadcast:to_user': (userId: string, event: string, data: any) => void;
  'user:disconnect': (userId: string, socketId: string) => void;
}

export interface SocketData {
  userId: string;
  userRole: 'STUDENT' | 'TEACHER' | 'ADMIN';
  classIds: string[];
  connectionTime: Date;
  lastActivity: Date;
  ipAddress?: string;
  userAgent?: string;
}

// Event Data Interfaces

export interface MessageEventData {
  id: string;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM' | 'AI_RESPONSE';
  classId: string;
  parentMessageId?: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    mimetype: string;
    size: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageDeletedEventData {
  messageId: string;
  classId: string;
  deletedBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
  type: 'soft_delete' | 'hard_delete';
  timestamp: Date;
}

export interface TypingEventData {
  userId: string;
  firstName: string;
  classId: string;
  timestamp: Date;
}

export interface PresenceEventData {
  userId: string;
  firstName: string;
  lastName: string;
  status: 'online' | 'offline' | 'away';
  lastSeen?: Date;
}

export interface ClassJoinEventData {
  userId: string;
  userName: string;
  classId: string;
  className: string;
  timestamp: Date;
}

export interface ClassLeaveEventData {
  userId: string;
  userName: string;
  classId: string;
  className: string;
  timestamp: Date;
}

export interface ClassUpdatedEventData {
  classId: string;
  className: string;
  changes: {
    name?: string;
    description?: string;
    status?: string;
  };
  updatedBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
  timestamp: Date;
}

export interface ClassMemberEventData {
  classId: string;
  className: string;
  member: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  action: 'added' | 'removed';
  timestamp: Date;
}

export interface NotificationEventData {
  id: string;
  type: 'message' | 'class_update' | 'system' | 'assignment';
  title: string;
  message: string;
  classId?: string;
  priority: 'low' | 'medium' | 'high';
  actionUrl?: string;
  createdAt: Date;
}

export interface NotificationReadEventData {
  notificationId: string;
  userId: string;
  readAt: Date;
}

export interface SystemEventData {
  type: 'maintenance' | 'announcement' | 'update';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  scheduledFor?: Date;
  estimatedDuration?: number; // minutes
}

export interface ErrorEventData {
  code: string;
  message: string;
  details?: any;
  timestamp: Date;
}

export interface AuthErrorEventData {
  reason: 'invalid_token' | 'expired_token' | 'insufficient_permissions';
  message: string;
  timestamp: Date;
}

export interface RateLimitEventData {
  event: string;
  limit: number;
  windowMs: number;
  retryAfter: number;
  timestamp: Date;
}

// Client to Server Event Data

export interface JoinClassData {
  classId: string;
}

export interface LeaveClassData {
  classId: string;
}

export interface SendMessageData {
  classId: string;
  content: string;
  type?: 'TEXT' | 'IMAGE' | 'FILE';
  parentMessageId?: string;
  metadata?: Record<string, any>;
}

export interface EditMessageData {
  messageId: string;
  classId: string;
  content: string;
}

export interface DeleteMessageData {
  messageId: string;
  classId: string;
}

export interface StartTypingData {
  classId: string;
}

export interface StopTypingData {
  classId: string;
}

export interface PresenceUpdateData {
  status: 'online' | 'away' | 'busy';
  customMessage?: string;
}

export interface MarkNotificationReadData {
  notificationId: string;
}

export interface MarkAllNotificationsReadData {
  classId?: string; // If provided, mark all for specific class
}

// Response Types

export interface AckResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
}

export interface MessageAckResponse extends AckResponse {
  messageId?: string;
  timestamp?: Date;
}

// Connection State

export interface UserConnection {
  socketId: string;
  userId: string;
  classIds: string[];
  connectedAt: Date;
  lastActivity: Date;
  isActive: boolean;
}

// Room Types

export interface RoomInfo {
  roomId: string;
  type: 'class' | 'direct' | 'system';
  members: Set<string>; // user IDs
  createdAt: Date;
  lastActivity: Date;
}

// Rate Limiting Types

export interface RateLimitConfig {
  eventType: string;
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitStatus {
  remaining: number;
  resetTime: Date;
  total: number;
} 