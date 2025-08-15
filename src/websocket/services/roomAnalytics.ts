import { Socket, Server as SocketIOServer } from 'socket.io';
import { createRedisClient } from '@/config/redis';
import { logger } from '@/utils/logger';
import { RoomManager, RoomInfo } from './roomManager';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  InterServerEvents, 
  SocketData 
} from '../types/events';

const redis = createRedisClient();

export interface RoomMetrics {
  roomId: string;
  timestamp: Date;
  activeUsers: number;
  totalMessages: number;
  messagesPerHour: number;
  averageMessageLength: number;
  userEngagement: {
    veryActive: number; // >10 messages/hour
    active: number;     // 3-10 messages/hour
    passive: number;    // 1-3 messages/hour
    lurkers: number;    // 0 messages but present
  };
  peakConcurrentUsers: number;
  averageSessionDuration: number; // in minutes
  fileUploads: number;
  moderationActions: number;
}

export interface UserActivity {
  userId: string;
  roomId: string;
  messagesCount: number;
  lastActivity: Date;
  sessionStart: Date;
  totalTimeSpent: number; // in minutes
  fileUploads: number;
  reactionsGiven: number;
  mentionsReceived: number;
  isCurrentlyActive: boolean;
}

export interface RoomInsights {
  roomId: string;
  period: 'hour' | 'day' | 'week' | 'month';
  summary: {
    totalMessages: number;
    uniqueUsers: number;
    averageUsersOnline: number;
    peakActivity: {
      timestamp: Date;
      userCount: number;
      messageCount: number;
    };
    engagementScore: number; // 0-100
    activityTrend: 'increasing' | 'stable' | 'decreasing';
  };
  topContributors: Array<{
    userId: string;
    messageCount: number;
    timeSpent: number;
    engagementScore: number;
  }>;
  timeDistribution: Array<{
    hour: number;
    messageCount: number;
    userCount: number;
  }>;
  contentAnalysis: {
    averageMessageLength: number;
    questionCount: number;
    linkShares: number;
    fileShares: number;
    reactions: number;
  };
}

export interface RoomHealthMetrics {
  roomId: string;
  health: {
    overall: 'excellent' | 'good' | 'fair' | 'poor';
    engagement: number; // 0-100
    participation: number; // 0-100
    moderation: number; // 0-100 (lower is better)
    growth: number; // 0-100
  };
  issues: Array<{
    type: 'low_engagement' | 'spam_detected' | 'inactive_users' | 'moderation_heavy';
    severity: 'low' | 'medium' | 'high';
    description: string;
    recommendation: string;
  }>;
  recommendations: string[];
}

export class RoomAnalyticsManager {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
  private roomManager: RoomManager;
  private metricsBuffer: Map<string, RoomMetrics[]> = new Map(); // roomId -> metrics history
  private userActivities: Map<string, Map<string, UserActivity>> = new Map(); // roomId -> userId -> activity
  private analyticsInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  constructor(
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
    roomManager: RoomManager
  ) {
    this.io = io;
    this.roomManager = roomManager;

    // Setup analytics collection intervals
    this.setupAnalyticsIntervals();

    // Initialize user activity tracking
    this.initializeUserActivities();

    logger.info('Room Analytics Manager initialized');
  }

  /**
   * Record user activity event
   */
  public recordUserActivity(
    roomId: string,
    userId: string,
    activityType: 'message' | 'join' | 'leave' | 'file_upload' | 'reaction' | 'mention'
  ): void {
    if (!this.userActivities.has(roomId)) {
      this.userActivities.set(roomId, new Map());
    }

    const roomActivities = this.userActivities.get(roomId)!;
    let userActivity = roomActivities.get(userId);

    if (!userActivity) {
      userActivity = {
        userId,
        roomId,
        messagesCount: 0,
        lastActivity: new Date(),
        sessionStart: new Date(),
        totalTimeSpent: 0,
        fileUploads: 0,
        reactionsGiven: 0,
        mentionsReceived: 0,
        isCurrentlyActive: true,
      };
      roomActivities.set(userId, userActivity);
    }

    // Update activity based on type
    switch (activityType) {
      case 'message':
        userActivity.messagesCount++;
        break;
      case 'file_upload':
        userActivity.fileUploads++;
        break;
      case 'reaction':
        userActivity.reactionsGiven++;
        break;
      case 'mention':
        userActivity.mentionsReceived++;
        break;
      case 'join':
        userActivity.sessionStart = new Date();
        userActivity.isCurrentlyActive = true;
        break;
      case 'leave':
        if (userActivity.isCurrentlyActive) {
          const sessionDuration = (Date.now() - userActivity.sessionStart.getTime()) / 60000; // minutes
          userActivity.totalTimeSpent += sessionDuration;
          userActivity.isCurrentlyActive = false;
        }
        break;
    }

    userActivity.lastActivity = new Date();

    // Store in Redis for persistence
    this.storeUserActivityInRedis(userActivity);
  }

  /**
   * Generate real-time metrics for a room
   */
  public generateRoomMetrics(roomId: string): RoomMetrics | null {
    const room = this.roomManager.getRoomInfo(roomId);
    if (!room) return null;

    const roomActivities = this.userActivities.get(roomId) || new Map();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);

    // Calculate metrics
    const activeUsers = Array.from(roomActivities.values())
      .filter(activity => activity.isCurrentlyActive).length;

    const recentActivities = Array.from(roomActivities.values())
      .filter(activity => activity.lastActivity > oneHourAgo);

    const totalMessages = Array.from(roomActivities.values())
      .reduce((sum, activity) => sum + activity.messagesCount, 0);

    const messagesPerHour = recentActivities
      .reduce((sum, activity) => sum + activity.messagesCount, 0);

    const fileUploads = Array.from(roomActivities.values())
      .reduce((sum, activity) => sum + activity.fileUploads, 0);

    // Calculate user engagement levels
    const userEngagement = this.calculateUserEngagement(roomActivities);

    // Calculate average session duration
    const activeSessions = recentActivities.filter(a => a.isCurrentlyActive);
    const averageSessionDuration = activeSessions.length > 0 ?
      activeSessions.reduce((sum, a) => sum + a.totalTimeSpent, 0) / activeSessions.length : 0;

    const metrics: RoomMetrics = {
      roomId,
      timestamp: now,
      activeUsers,
      totalMessages,
      messagesPerHour,
      averageMessageLength: 0, // Would calculate from actual message content
      userEngagement,
      peakConcurrentUsers: room.metadata.peakConcurrentUsers,
      averageSessionDuration,
      fileUploads,
      moderationActions: 0, // Would get from moderation manager
    };

    // Store metrics in buffer
    if (!this.metricsBuffer.has(roomId)) {
      this.metricsBuffer.set(roomId, []);
    }
    const metricsHistory = this.metricsBuffer.get(roomId)!;
    metricsHistory.push(metrics);

    // Keep only last 24 hours of metrics
    const dayAgo = new Date(now.getTime() - 86400000);
    const filteredHistory = metricsHistory.filter(m => m.timestamp > dayAgo);
    this.metricsBuffer.set(roomId, filteredHistory);

    return metrics;
  }

  /**
   * Calculate user engagement levels
   */
  private calculateUserEngagement(roomActivities: Map<string, UserActivity>): RoomMetrics['userEngagement'] {
    const engagement = {
      veryActive: 0,
      active: 0,
      passive: 0,
      lurkers: 0,
    };

    for (const activity of roomActivities.values()) {
      const hourlyMessages = activity.messagesCount; // Simplified calculation
      
      if (hourlyMessages > 10) {
        engagement.veryActive++;
      } else if (hourlyMessages >= 3) {
        engagement.active++;
      } else if (hourlyMessages >= 1) {
        engagement.passive++;
      } else if (activity.isCurrentlyActive) {
        engagement.lurkers++;
      }
    }

    return engagement;
  }

  /**
   * Generate comprehensive room insights
   */
  public generateRoomInsights(
    roomId: string,
    period: RoomInsights['period'] = 'day'
  ): RoomInsights | null {
    const room = this.roomManager.getRoomInfo(roomId);
    if (!room) return null;

    const roomActivities = this.userActivities.get(roomId) || new Map();
    const metricsHistory = this.metricsBuffer.get(roomId) || [];

    // Calculate period boundaries
    const now = new Date();
    const periodStart = this.getPeriodStart(now, period);

    // Filter data for the period
    const periodMetrics = metricsHistory.filter(m => m.timestamp >= periodStart);
    const periodActivities = Array.from(roomActivities.values())
      .filter(a => a.lastActivity >= periodStart);

    // Calculate summary metrics
    const totalMessages = periodActivities.reduce((sum, a) => sum + a.messagesCount, 0);
    const uniqueUsers = periodActivities.length;
    const averageUsersOnline = periodMetrics.length > 0 ?
      periodMetrics.reduce((sum, m) => sum + m.activeUsers, 0) / periodMetrics.length : 0;

    // Find peak activity
    const peakActivity = periodMetrics.reduce((peak, current) => {
      const currentActivity = current.activeUsers + current.messagesPerHour;
      const peakActivityScore = peak.userCount + peak.messageCount;
      return currentActivity > peakActivityScore ? {
        timestamp: current.timestamp,
        userCount: current.activeUsers,
        messageCount: current.messagesPerHour,
      } : peak;
    }, { timestamp: now, userCount: 0, messageCount: 0 });

    // Calculate engagement score (0-100)
    const engagementScore = this.calculateEngagementScore(periodActivities, room);

    // Determine activity trend
    const activityTrend = this.calculateActivityTrend(periodMetrics);

    // Get top contributors
    const topContributors = periodActivities
      .sort((a, b) => b.messagesCount - a.messagesCount)
      .slice(0, 10)
      .map(activity => ({
        userId: activity.userId,
        messageCount: activity.messagesCount,
        timeSpent: activity.totalTimeSpent,
        engagementScore: this.calculateUserEngagementScore(activity),
      }));

    // Generate time distribution
    const timeDistribution = this.generateTimeDistribution(periodMetrics);

    // Content analysis
    const contentAnalysis = {
      averageMessageLength: 0, // Would calculate from message content
      questionCount: 0,        // Would analyze message content
      linkShares: 0,           // Would track link sharing
      fileShares: periodActivities.reduce((sum, a) => sum + a.fileUploads, 0),
      reactions: periodActivities.reduce((sum, a) => sum + a.reactionsGiven, 0),
    };

    const insights: RoomInsights = {
      roomId,
      period,
      summary: {
        totalMessages,
        uniqueUsers,
        averageUsersOnline,
        peakActivity,
        engagementScore,
        activityTrend,
      },
      topContributors,
      timeDistribution,
      contentAnalysis,
    };

    return insights;
  }

  /**
   * Generate room health metrics
   */
  public generateRoomHealthMetrics(roomId: string): RoomHealthMetrics | null {
    const room = this.roomManager.getRoomInfo(roomId);
    if (!room) return null;

    const insights = this.generateRoomInsights(roomId, 'day');
    if (!insights) return null;

    // Calculate health scores
    const engagement = Math.min(100, insights.summary.engagementScore);
    const participation = Math.min(100, (insights.summary.uniqueUsers / room.memberIds.size) * 100);
    const moderation = Math.max(0, 100 - (insights.contentAnalysis.reactions * 10)); // Lower is better
    const growth = this.calculateGrowthScore(roomId);

    const overall = this.calculateOverallHealth(engagement, participation, moderation, growth);

    // Identify issues and recommendations
    const issues: RoomHealthMetrics['issues'] = [];
    const recommendations: string[] = [];

    if (engagement < 30) {
      issues.push({
        type: 'low_engagement',
        severity: 'high',
        description: 'Room engagement is below optimal levels',
        recommendation: 'Consider posting engaging content or organizing activities',
      });
      recommendations.push('Post interesting discussion topics or questions');
      recommendations.push('Organize regular activities or events');
    }

    if (participation < 50) {
      issues.push({
        type: 'inactive_users',
        severity: 'medium',
        description: 'Many users are not actively participating',
        recommendation: 'Encourage participation through direct engagement',
      });
      recommendations.push('Tag inactive users in discussions');
      recommendations.push('Create smaller discussion groups');
    }

    const healthMetrics: RoomHealthMetrics = {
      roomId,
      health: {
        overall,
        engagement,
        participation,
        moderation,
        growth,
      },
      issues,
      recommendations,
    };

    return healthMetrics;
  }

  /**
   * Get real-time analytics for admin dashboard
   */
  public getRealTimeAnalytics(): {
    totalRooms: number;
    activeRooms: number;
    totalUsers: number;
    totalMessages: number;
    topRooms: Array<{
      roomId: string;
      roomName: string;
      activeUsers: number;
      messagesPerHour: number;
    }>;
  } {
    const allRooms = this.roomManager.getAllRooms();
    const activeRooms = allRooms.filter(room => room.metadata.activeMembers > 0);
    
    let totalUsers = 0;
    let totalMessages = 0;
    const roomMetrics: Array<{
      roomId: string;
      roomName: string;
      activeUsers: number;
      messagesPerHour: number;
    }> = [];

    for (const room of allRooms) {
      totalUsers += room.memberIds.size;
      
      const metrics = this.generateRoomMetrics(room.roomId);
      if (metrics) {
        totalMessages += metrics.totalMessages;
        roomMetrics.push({
          roomId: room.roomId,
          roomName: room.name,
          activeUsers: metrics.activeUsers,
          messagesPerHour: metrics.messagesPerHour,
        });
      }
    }

    // Sort by activity level
    const topRooms = roomMetrics
      .sort((a, b) => (b.activeUsers + b.messagesPerHour) - (a.activeUsers + a.messagesPerHour))
      .slice(0, 10);

    return {
      totalRooms: allRooms.length,
      activeRooms: activeRooms.length,
      totalUsers,
      totalMessages,
      topRooms,
    };
  }

  /**
   * Helper methods
   */
  private getPeriodStart(now: Date, period: RoomInsights['period']): Date {
    switch (period) {
      case 'hour':
        return new Date(now.getTime() - 3600000);
      case 'day':
        return new Date(now.getTime() - 86400000);
      case 'week':
        return new Date(now.getTime() - 604800000);
      case 'month':
        return new Date(now.getTime() - 2592000000);
      default:
        return new Date(now.getTime() - 86400000);
    }
  }

  private calculateEngagementScore(activities: UserActivity[], room: RoomInfo): number {
    if (activities.length === 0) return 0;

    const totalMessages = activities.reduce((sum, a) => sum + a.messagesCount, 0);
    const averageMessagesPerUser = totalMessages / activities.length;
    const participationRate = activities.length / room.memberIds.size;

    // Simple engagement formula (can be refined)
    const score = Math.min(100, (averageMessagesPerUser * 10) + (participationRate * 50));
    return Math.round(score);
  }

  private calculateActivityTrend(metrics: RoomMetrics[]): 'increasing' | 'stable' | 'decreasing' {
    if (metrics.length < 2) return 'stable';

    const recent = metrics.slice(-5); // Last 5 data points
    const older = metrics.slice(-10, -5); // Previous 5 data points

    if (recent.length === 0 || older.length === 0) return 'stable';

    const recentAvg = recent.reduce((sum, m) => sum + m.messagesPerHour, 0) / recent.length;
    const olderAvg = older.reduce((sum, m) => sum + m.messagesPerHour, 0) / older.length;

    const changePercentage = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (changePercentage > 10) return 'increasing';
    if (changePercentage < -10) return 'decreasing';
    return 'stable';
  }

  private calculateUserEngagementScore(activity: UserActivity): number {
    const messageScore = Math.min(50, activity.messagesCount * 2);
    const timeScore = Math.min(30, activity.totalTimeSpent / 60 * 10);
    const interactionScore = Math.min(20, (activity.reactionsGiven + activity.mentionsReceived) * 5);

    return Math.round(messageScore + timeScore + interactionScore);
  }

  private generateTimeDistribution(metrics: RoomMetrics[]): RoomInsights['timeDistribution'] {
    const distribution: Record<number, { messageCount: number; userCount: number }> = {};

    for (let hour = 0; hour < 24; hour++) {
      distribution[hour] = { messageCount: 0, userCount: 0 };
    }

    for (const metric of metrics) {
      const hour = metric.timestamp.getHours();
      if (distribution[hour]) {
        distribution[hour].messageCount += metric.messagesPerHour;
        distribution[hour].userCount += metric.activeUsers;
      }
    }

    return Object.entries(distribution).map(([hour, data]) => ({
      hour: parseInt(hour),
      messageCount: data.messageCount,
      userCount: Math.round(data.userCount / metrics.length) || 0,
    }));
  }

  private calculateGrowthScore(roomId: string): number {
    // Simple growth calculation based on recent member additions
    // This would typically involve historical data
    return 75; // Placeholder
  }

  private calculateOverallHealth(
    engagement: number,
    participation: number,
    moderation: number,
    growth: number
  ): RoomHealthMetrics['health']['overall'] {
    const average = (engagement + participation + moderation + growth) / 4;

    if (average >= 80) return 'excellent';
    if (average >= 60) return 'good';
    if (average >= 40) return 'fair';
    return 'poor';
  }

  private async storeUserActivityInRedis(activity: UserActivity): Promise<void> {
    try {
      const key = `room_activity:${activity.roomId}:${activity.userId}`;
      await redis.setex(key, 86400, JSON.stringify(activity)); // 24 hours TTL
    } catch (error) {
      logger.warn('Failed to store user activity in Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId: activity.roomId,
        userId: activity.userId,
      });
    }
  }

  private setupAnalyticsIntervals(): void {
    // Collect metrics every 5 minutes
    this.metricsInterval = setInterval(() => {
      this.collectAllRoomMetrics();
    }, 300000);

    // Generate analytics every hour
    this.analyticsInterval = setInterval(() => {
      this.generateAllRoomAnalytics();
    }, 3600000);

    logger.debug('Analytics intervals configured', {
      metricsInterval: '5 minutes',
      analyticsInterval: '1 hour',
    });
  }

  private collectAllRoomMetrics(): void {
    const allRooms = this.roomManager.getAllRooms();
    
    for (const room of allRooms) {
      const metrics = this.generateRoomMetrics(room.roomId);
      if (metrics) {
        // Broadcast real-time metrics to room moderators
        this.io.to(room.roomId).emit('room:metrics_update', {
          roomId: room.roomId,
          metrics: {
            activeUsers: metrics.activeUsers,
            messagesPerHour: metrics.messagesPerHour,
            userEngagement: metrics.userEngagement,
          },
          timestamp: new Date(),
        });
      }
    }

    logger.debug('Room metrics collection completed', {
      roomsProcessed: allRooms.length,
    });
  }

  private generateAllRoomAnalytics(): void {
    const allRooms = this.roomManager.getAllRooms();
    
    for (const room of allRooms) {
      const insights = this.generateRoomInsights(room.roomId, 'day');
      const healthMetrics = this.generateRoomHealthMetrics(room.roomId);

      if (insights && healthMetrics) {
        // Store analytics in Redis for dashboard
        this.storeAnalyticsInRedis(room.roomId, { insights, healthMetrics });
      }
    }

    logger.debug('Room analytics generation completed', {
      roomsProcessed: allRooms.length,
    });
  }

  private async storeAnalyticsInRedis(
    roomId: string,
    analytics: { insights: RoomInsights; healthMetrics: RoomHealthMetrics }
  ): Promise<void> {
    try {
      const key = `room_analytics:${roomId}`;
      await redis.setex(key, 3600, JSON.stringify(analytics)); // 1 hour TTL
    } catch (error) {
      logger.warn('Failed to store analytics in Redis', {
        error: error instanceof Error ? error.message : 'Unknown error',
        roomId,
      });
    }
  }

  private initializeUserActivities(): void {
    // Initialize user activities for existing rooms
    const allRooms = this.roomManager.getAllRooms();
    
    for (const room of allRooms) {
      if (!this.userActivities.has(room.roomId)) {
        this.userActivities.set(room.roomId, new Map());
      }
    }

    logger.debug('User activities initialized', {
      roomsInitialized: allRooms.length,
    });
  }

  /**
   * Cleanup and destroy
   */
  public destroy(): void {
    if (this.analyticsInterval) {
      clearInterval(this.analyticsInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    this.metricsBuffer.clear();
    this.userActivities.clear();

    logger.info('Room Analytics Manager destroyed');
  }
} 