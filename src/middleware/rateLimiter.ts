import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/environment';
import { loggers } from '@/utils/logger';
import { RateLimitError } from '@/middleware/errorHandler';

// Custom key generator based on user role
const keyGenerator = (req: Request): string => {
  const baseKey = req.ip || 'unknown';
  const userId = (req as any).user?.id;
  const userRole = (req as any).user?.role;
  
  if (userId && userRole) {
    return `${baseKey}:${userId}:${userRole}`;
  }
  
  return baseKey;
};

// Custom handler for rate limit exceeded
const rateLimitHandler = (req: Request, res: Response, next: NextFunction): void => {
  const userRole = (req as any).user?.role || 'anonymous';
  const endpoint = req.originalUrl;
  
  // Log rate limit exceeded
  loggers.security.rateLimitExceeded(req.ip || 'unknown', endpoint);
  
  const error = new RateLimitError(
    `Rate limit exceeded. Too many requests from ${userRole} user.`
  );
  
  next(error);
};

// Skip function for rate limiting
const skipSuccessfulRequests = (req: Request, res: Response): boolean => {
  // Skip rate limiting for health checks
  if (req.path === '/health') {
    return true;
  }
  
  // Skip if response is successful (2xx status)
  return res.statusCode < 400;
};

// General rate limiter
export const rateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  keyGenerator,
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});

// Student-specific rate limiter (more restrictive)
export const studentRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.studentMax,
  keyGenerator: (req: Request) => `student:${req.ip}:${(req as any).user?.id || 'anonymous'}`,
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    // Only apply to students
    return (req as any).user?.role !== 'STUDENT';
  },
});

// Teacher-specific rate limiter (more permissive)
export const teacherRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.teacherMax,
  keyGenerator: (req: Request) => `teacher:${req.ip}:${(req as any).user?.id || 'anonymous'}`,
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    // Only apply to teachers
    return (req as any).user?.role !== 'TEACHER';
  },
});

// AI request rate limiter (more restrictive for AI endpoints)
export const aiRateLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: (req: Request) => {
    // Different limits based on user role
    if ((req as any).user?.role === 'TEACHER') {
      return 30; // Teachers can make more AI requests
    }
    return 10; // Students have lower limit
  },
  keyGenerator: (req: Request) => `ai:${req.ip}:${(req as any).user?.id || 'anonymous'}`,
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many AI requests, please slow down.',
  },
});

// File upload rate limiter
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60000, // 15 minutes
  max: 20, // 20 file uploads per 15 minutes
  keyGenerator: (req: Request) => `upload:${req.ip}:${(req as any).user?.id || 'anonymous'}`,
  handler: rateLimitHandler,
  skipSuccessfulRequests: true, // Only count failed uploads
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many file uploads, please try again later.',
  },
});

// Authentication rate limiter (for login attempts)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  keyGenerator: (req: Request) => `auth:${req.ip}`,
  handler: rateLimitHandler,
  skipSuccessfulRequests: true, // Only count failed login attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts, please try again later.',
  },
});

// Middleware to apply role-based rate limiting
export const roleBasedRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  if ((req as any).user?.role === 'STUDENT') {
    studentRateLimiter(req, res, next);
  } else if ((req as any).user?.role === 'TEACHER') {
    teacherRateLimiter(req, res, next);
  } else {
    rateLimiter(req, res, next);
  }
}; 