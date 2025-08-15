import { Socket } from 'socket.io';
import { logger } from '@/utils/logger';
import type { RateLimitConfig, RateLimitStatus } from '../types/events';

interface RateLimitEntry {
  count: number;
  resetTime: number;
  firstRequest: number;
}

export class RateLimiter {
  private limits: Map<string, Map<string, RateLimitEntry>> = new Map(); // socketId -> eventType -> entry
  private configs: Map<string, RateLimitConfig> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Default rate limit configurations
    this.setEventLimit('message:send', 30, 60000); // 30 messages per minute
    this.setEventLimit('message:edit', 10, 60000); // 10 edits per minute
    this.setEventLimit('message:delete', 5, 60000); // 5 deletions per minute
    this.setEventLimit('typing:start', 60, 60000); // 60 typing events per minute
    this.setEventLimit('join:class', 10, 60000); // 10 room joins per minute
    this.setEventLimit('leave:class', 10, 60000); // 10 room leaves per minute

    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 300000);

    logger.info('WebSocket RateLimiter initialized with default limits');
  }

  public setEventLimit(
    eventType: string, 
    maxRequests: number, 
    windowMs: number,
    skipSuccessfulRequests: boolean = false,
    skipFailedRequests: boolean = false
  ): void {
    this.configs.set(eventType, {
      eventType,
      maxRequests,
      windowMs,
      skipSuccessfulRequests,
      skipFailedRequests,
    });

    logger.debug('Rate limit configured for event', {
      eventType,
      maxRequests,
      windowMs,
    });
  }

  public checkLimit(socket: Socket, eventType: string): { allowed: boolean; status: RateLimitStatus } {
    const config = this.configs.get(eventType);
    
    // If no limit configured for this event, allow it
    if (!config) {
      return {
        allowed: true,
        status: {
          remaining: Infinity,
          resetTime: new Date(Date.now() + 3600000), // 1 hour from now
          total: Infinity,
        },
      };
    }

    const now = Date.now();
    const socketId = socket.id;
    
    // Initialize socket limits if not exists
    if (!this.limits.has(socketId)) {
      this.limits.set(socketId, new Map());
    }
    
    const socketLimits = this.limits.get(socketId)!;
    let entry = socketLimits.get(eventType);

    // Initialize or reset entry if window expired
    if (!entry || now >= entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
        firstRequest: now,
      };
      socketLimits.set(eventType, entry);
    }

    // Check if limit exceeded
    const allowed = entry.count < config.maxRequests;
    
    if (allowed) {
      entry.count++;
    }

    const status: RateLimitStatus = {
      remaining: Math.max(0, config.maxRequests - entry.count),
      resetTime: new Date(entry.resetTime),
      total: config.maxRequests,
    };

    // Log rate limit violations
    if (!allowed) {
      const socketData = socket.data;
      logger.warn('Rate limit exceeded', {
        socketId,
        userId: socketData?.userId,
        eventType,
        limit: config.maxRequests,
        windowMs: config.windowMs,
        count: entry.count,
        ip: socketData?.ipAddress,
      });

      // Emit rate limit exceeded event to client
      socket.emit('rate_limit:exceeded', {
        event: eventType,
        limit: config.maxRequests,
        windowMs: config.windowMs,
        retryAfter: entry.resetTime - now,
        timestamp: new Date(),
      });
    }

    return { allowed, status };
  }

  public recordSuccess(socket: Socket, eventType: string): void {
    const config = this.configs.get(eventType);
    if (!config || !config.skipSuccessfulRequests) {
      return;
    }

    // Decrease count for successful requests if configured to skip them
    const socketId = socket.id;
    const socketLimits = this.limits.get(socketId);
    const entry = socketLimits?.get(eventType);

    if (entry && entry.count > 0) {
      entry.count--;
      logger.debug('Rate limit count decreased for successful request', {
        socketId,
        eventType,
        newCount: entry.count,
      });
    }
  }

  public recordFailure(socket: Socket, eventType: string): void {
    const config = this.configs.get(eventType);
    if (!config || !config.skipFailedRequests) {
      return;
    }

    // Decrease count for failed requests if configured to skip them
    const socketId = socket.id;
    const socketLimits = this.limits.get(socketId);
    const entry = socketLimits?.get(eventType);

    if (entry && entry.count > 0) {
      entry.count--;
      logger.debug('Rate limit count decreased for failed request', {
        socketId,
        eventType,
        newCount: entry.count,
      });
    }
  }

  public resetUserLimits(socketId: string): void {
    this.limits.delete(socketId);
    logger.debug('Rate limits reset for socket', { socketId });
  }

  public resetEventLimit(socket: Socket, eventType: string): void {
    const socketId = socket.id;
    const socketLimits = this.limits.get(socketId);
    
    if (socketLimits) {
      socketLimits.delete(eventType);
      logger.debug('Rate limit reset for event', { socketId, eventType });
    }
  }

  public getStatus(socket: Socket, eventType: string): RateLimitStatus | null {
    const config = this.configs.get(eventType);
    if (!config) return null;

    const socketId = socket.id;
    const socketLimits = this.limits.get(socketId);
    const entry = socketLimits?.get(eventType);

    if (!entry) {
      return {
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowMs),
        total: config.maxRequests,
      };
    }

    return {
      remaining: Math.max(0, config.maxRequests - entry.count),
      resetTime: new Date(entry.resetTime),
      total: config.maxRequests,
    };
  }

  public getAllStatuses(socket: Socket): Record<string, RateLimitStatus> {
    const statuses: Record<string, RateLimitStatus> = {};
    
    for (const [eventType] of this.configs) {
      const status = this.getStatus(socket, eventType);
      if (status) {
        statuses[eventType] = status;
      }
    }

    return statuses;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleanedSockets = 0;
    let cleanedEntries = 0;

    for (const [socketId, socketLimits] of this.limits) {
      for (const [eventType, entry] of socketLimits) {
        if (now >= entry.resetTime) {
          socketLimits.delete(eventType);
          cleanedEntries++;
        }
      }

      // Remove empty socket limit maps
      if (socketLimits.size === 0) {
        this.limits.delete(socketId);
        cleanedSockets++;
      }
    }

    if (cleanedSockets > 0 || cleanedEntries > 0) {
      logger.debug('Rate limiter cleanup completed', {
        cleanedSockets,
        cleanedEntries,
        remainingSockets: this.limits.size,
      });
    }
  }

  public getStats(): {
    totalSockets: number;
    totalEntries: number;
    configuredEvents: string[];
  } {
    let totalEntries = 0;
    
    for (const socketLimits of this.limits.values()) {
      totalEntries += socketLimits.size;
    }

    return {
      totalSockets: this.limits.size,
      totalEntries,
      configuredEvents: Array.from(this.configs.keys()),
    };
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.limits.clear();
    this.configs.clear();
    logger.info('WebSocket RateLimiter destroyed');
  }
}

// Middleware function to check rate limits before event execution
export const checkRateLimit = (eventType: string) => {
  return (socket: Socket, next: (err?: Error) => void) => {
    const rateLimiter = (socket as any).rateLimiter as RateLimiter;
    
    if (!rateLimiter) {
      logger.warn('Rate limiter not found on socket');
      return next();
    }

    const { allowed } = rateLimiter.checkLimit(socket, eventType);
    
    if (!allowed) {
      return next(new Error(`Rate limit exceeded for ${eventType}`));
    }

    next();
  };
}; 