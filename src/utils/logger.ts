import winston from 'winston';
import path from 'path';
import { config } from '@/config/environment';

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let logMessage = `${timestamp} [${level}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Create logs directory if it doesn't exist
const logsDir = path.dirname(config.logging.file);

// Create Winston logger
export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: {
    service: 'agent-english-teacher-backend',
    environment: config.nodeEnv,
  },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    
    // File transport for combined logs
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
  exitOnError: false,
});

// Add console transport for development
if (config.isDevelopment) {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
      level: 'debug',
    })
  );
}

// Add console transport for production (warnings and errors only)
if (config.isProduction) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
      level: 'warn',
    })
  );
}

// Create a stream for Morgan HTTP logging
export const loggerStream = {
  write: (message: string): void => {
    logger.info(message.trim());
  },
};

// Helper functions for structured logging
export const loggers = {
  // HTTP request logging
  request: (req: any, res: any, responseTime: number) => {
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user?.id,
    });
  },

  // Authentication events
  auth: {
    login: (userId: string, email: string, ip: string) => {
      logger.info('User Login', { userId, email, ip, event: 'LOGIN' });
    },
    logout: (userId: string, email: string) => {
      logger.info('User Logout', { userId, email, event: 'LOGOUT' });
    },
    loginFailed: (email: string, ip: string, reason: string) => {
      logger.warn('Login Failed', { email, ip, reason, event: 'LOGIN_FAILED' });
    },
  },

  // Database operations
  db: {
    query: (query: string, duration: number) => {
      logger.debug('Database Query', { query, duration: `${duration}ms` });
    },
    error: (operation: string, error: Error) => {
      logger.error('Database Error', { operation, error: error.message, stack: error.stack });
    },
  },

  // AI operations
  ai: {
    request: (userId: string, model: string, tokens: number) => {
      logger.info('AI Request', { userId, model, tokens, event: 'AI_REQUEST' });
    },
    error: (userId: string, model: string, error: Error) => {
      logger.error('AI Error', { userId, model, error: error.message, event: 'AI_ERROR' });
    },
  },

  // File operations
  file: {
    upload: (userId: string, filename: string, size: number) => {
      logger.info('File Upload', { userId, filename, size, event: 'FILE_UPLOAD' });
    },
    delete: (userId: string, filename: string) => {
      logger.info('File Delete', { userId, filename, event: 'FILE_DELETE' });
    },
    error: (operation: string, filename: string, error: Error) => {
      logger.error('File Error', { operation, filename, error: error.message });
    },
  },

  // Security events
  security: {
    rateLimitExceeded: (ip: string, endpoint: string) => {
      logger.warn('Rate Limit Exceeded', { ip, endpoint, event: 'RATE_LIMIT_EXCEEDED' });
    },
    suspiciousActivity: (userId: string, activity: string, details: any) => {
      logger.warn('Suspicious Activity', { userId, activity, details, event: 'SUSPICIOUS_ACTIVITY' });
    },
    unauthorized: (ip: string, endpoint: string, reason: string) => {
      logger.warn('Unauthorized Access', { ip, endpoint, reason, event: 'UNAUTHORIZED' });
    },
  },
}; 