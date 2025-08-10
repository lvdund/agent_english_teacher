import Redis from 'ioredis';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';

// Redis client instance
let redisClient: Redis | null = null;

// Redis connection configuration
const getRedisConfig = () => {
  const baseConfig = {
    host: 'localhost',
    port: 6379,
    db: config.redis.db,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    keepAlive: 30000,
    connectTimeout: 10000,
    commandTimeout: 5000,
  };

  // Only add password if it exists
  if (config.redis.password) {
    return {
      ...baseConfig,
      password: config.redis.password,
    };
  }

  return baseConfig;
};

// Create Redis client
export const createRedisClient = (): Redis => {
  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = new Redis(getRedisConfig());

    // Redis event handlers
    redisClient.on('connect', () => {
      logger.info('📡 Redis connecting...');
    });

    redisClient.on('ready', () => {
      logger.info('✅ Redis connection ready');
    });

    redisClient.on('error', (error) => {
      logger.error('❌ Redis connection error:', error);
    });

    redisClient.on('close', () => {
      logger.warn('🔌 Redis connection closed');
    });

    redisClient.on('reconnecting', () => {
      logger.info('🔄 Redis reconnecting...');
    });

    return redisClient;
  } catch (error) {
    logger.error('Failed to create Redis client:', error);
    throw error;
  }
};

// Get Redis client instance
export const getRedisClient = (): Redis => {
  if (!redisClient) {
    return createRedisClient();
  }
  return redisClient;
};

// Close Redis connection
export const closeRedisConnection = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('🔴 Redis connection closed');
  }
};

// Test Redis connection
export const testRedisConnection = async (): Promise<boolean> => {
  try {
    const client = getRedisClient();
    await client.ping();
    logger.info('✅ Redis ping successful');
    return true;
  } catch (error) {
    logger.error('❌ Redis ping failed:', error);
    return false;
  }
};

// Redis utility functions
export const redisUtils = {
  // Set value with TTL
  async set(key: string, value: string | object, ttlSeconds?: number): Promise<void> {
    const client = getRedisClient();
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
    
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, serializedValue);
    } else {
      await client.set(key, serializedValue);
    }
  },

  // Get value and parse if JSON
  async get(key: string): Promise<any> {
    const client = getRedisClient();
    const value = await client.get(key);
    
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  },

  // Delete key
  async del(key: string): Promise<void> {
    const client = getRedisClient();
    await client.del(key);
  },

  // Check if key exists
  async exists(key: string): Promise<boolean> {
    const client = getRedisClient();
    const result = await client.exists(key);
    return result === 1;
  },

  // Set TTL for existing key
  async expire(key: string, seconds: number): Promise<void> {
    const client = getRedisClient();
    await client.expire(key, seconds);
  },

  // Get TTL for key
  async ttl(key: string): Promise<number> {
    const client = getRedisClient();
    return await client.ttl(key);
  },

  // Increment counter
  async incr(key: string): Promise<number> {
    const client = getRedisClient();
    return await client.incr(key);
  },

  // Set if not exists
  async setnx(key: string, value: string | object): Promise<boolean> {
    const client = getRedisClient();
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
    const result = await client.setnx(key, serializedValue);
    return result === 1;
  },

  // Get multiple keys
  async mget(keys: string[]): Promise<(string | null)[]> {
    const client = getRedisClient();
    return await client.mget(...keys);
  },

  // Set multiple keys
  async mset(keyValuePairs: Record<string, string | object>): Promise<void> {
    const client = getRedisClient();
    const pairs: string[] = [];
    
    Object.entries(keyValuePairs).forEach(([key, value]) => {
      pairs.push(key);
      pairs.push(typeof value === 'object' ? JSON.stringify(value) : value);
    });
    
    await client.mset(...pairs);
  },

  // Pattern matching keys
  async keys(pattern: string): Promise<string[]> {
    const client = getRedisClient();
    return await client.keys(pattern);
  },

  // Clear all keys matching pattern
  async clearPattern(pattern: string): Promise<number> {
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    
    if (keys.length === 0) return 0;
    
    return await client.del(...keys);
  },
};

// Redis key generators for consistent naming
export const redisKeys = {
  // User sessions
  userSession: (userId: string) => `session:user:${userId}`,
  
  // Rate limiting
  rateLimit: (identifier: string, window: string) => `rate_limit:${identifier}:${window}`,
  
  // Authentication
  refreshToken: (tokenId: string) => `refresh_token:${tokenId}`,
  loginAttempts: (ip: string) => `login_attempts:${ip}`,
  
  // Caching
  userProfile: (userId: string) => `cache:user:${userId}`,
  classData: (classId: string) => `cache:class:${classId}`,
  messageThread: (messageId: string) => `cache:thread:${messageId}`,
  
  // Real-time features
  onlineUsers: (classId: string) => `online:class:${classId}`,
  typingUsers: (classId: string) => `typing:class:${classId}`,
  
  // AI interactions
  aiCache: (prompt: string) => `ai_cache:${Buffer.from(prompt).toString('base64').slice(0, 50)}`,
  
  // Background jobs
  jobQueue: (queueName: string) => `queue:${queueName}`,
  jobResult: (jobId: string) => `job_result:${jobId}`,
};

export default redisClient; 