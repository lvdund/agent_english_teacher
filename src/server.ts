import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { config } from '@/config/environment';
import { errorHandler } from '@/middleware/errorHandler';
import { notFoundHandler } from '@/middleware/notFoundHandler';
import { rateLimiter } from '@/middleware/rateLimiter';
import { logger } from '@/utils/logger';
import { createRedisClient, testRedisConnection, closeRedisConnection } from '@/config/redis';
import { connectDatabase, testDatabaseConnection, disconnectDatabase, getDatabaseHealth } from '@/config/database';

// Import routes (will be created in later phases)
// import authRoutes from '@/routes/auth';
// import userRoutes from '@/routes/users';
// import classRoutes from '@/routes/classes';
// import messageRoutes from '@/routes/messages';

const app = express();
const server = createServer(app);

// Socket.IO setup (will be configured in Phase 6)
const io = new SocketIOServer(server, {
  cors: {
    origin: config.cors.origin,
    credentials: config.cors.credentials,
  },
});

// Security middleware
app.use(helmet());
app.use(compression());

// CORS configuration
app.use(
  cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
  })
);

// Logging middleware
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(rateLimiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test Redis connection
    const redisHealthy = await testRedisConnection();
    
    // Test database connection
    const dbHealth = await getDatabaseHealth();
    
    const healthStatus = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.nodeEnv,
      services: {
        database: {
          status: dbHealth.connected ? 'connected' : 'disconnected',
          version: dbHealth.version,
        },
        redis: {
          status: redisHealthy ? 'connected' : 'disconnected',
        },
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        },
      },
    };

    // Return 503 if any critical service is down
    const allServicesHealthy = dbHealth.connected && redisHealthy;
    const statusCode = allServicesHealthy ? 200 : 503;
    
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// API routes (will be uncommented as they are created)
// app.use('/api/auth', authRoutes);
// app.use('/api/users', userRoutes);
// app.use('/api/classes', classRoutes);
// app.use('/api/messages', messageRoutes);

// Error handling middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const startServer = async (): Promise<void> => {
  try {
    // Initialize Redis connection
    logger.info('🔄 Initializing Redis connection...');
    createRedisClient();
    
    // Test Redis connection
    const redisConnected = await testRedisConnection();
    if (!redisConnected) {
      logger.warn('⚠️ Redis connection failed, continuing without cache');
    }

    // Initialize Database connection
    logger.info('🔄 Initializing database connection...');
    await connectDatabase();
    
    // Test database connection
    const dbConnected = await testDatabaseConnection();
    if (!dbConnected) {
      logger.error('❌ Database connection failed, cannot continue');
      process.exit(1);
    }
    
    server.listen(config.port, () => {
      logger.info(`🚀 Server running on ${config.host}:${config.port}`);
      logger.info(`📝 Environment: ${config.nodeEnv}`);
      logger.info(`🔗 Health check: http://${config.host}:${config.port}/health`);
      if (redisConnected) {
        logger.info(`🔴 Redis: Connected and ready`);
      }
      logger.info(`🐘 PostgreSQL: Connected and ready`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await Promise.all([
    closeRedisConnection(),
    disconnectDatabase(),
  ]);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await Promise.all([
    closeRedisConnection(),
    disconnectDatabase(),
  ]);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

startServer().catch(error => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

export { app, server, io }; 