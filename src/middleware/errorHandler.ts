import { Request, Response, NextFunction } from 'express';
import { logger } from '@/utils/logger';
import { config } from '@/config/environment';

// Custom error class
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public code?: string;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Database error handler
const handleDatabaseError = (error: any): AppError => {
  if (error.code === 'P2002') {
    // Prisma unique constraint violation
    const field = error.meta?.target?.[0] || 'field';
    return new AppError(`${field} already exists`, 409);
  }
  
  if (error.code === 'P2025') {
    // Record not found
    return new AppError('Record not found', 404);
  }

  if (error.code === 'P2003') {
    // Foreign key constraint violation
    return new AppError('Invalid reference to related resource', 400);
  }

  return new AppError('Database operation failed', 500);
};

// JWT error handler
const handleJWTError = (error: any): AppError => {
  if (error.name === 'JsonWebTokenError') {
    return new AppError('Invalid token', 401);
  }
  
  if (error.name === 'TokenExpiredError') {
    return new AppError('Token expired', 401);
  }

  return new AppError('Authentication failed', 401);
};

// Validation error handler
const handleValidationError = (error: any): AppError => {
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map((err: any) => err.message);
    return new AppError(`Validation failed: ${errors.join(', ')}`, 400);
  }

  return new AppError('Validation failed', 400);
};

// Send error response for development
const sendErrorDev = (error: AppError, res: Response): void => {
  res.status(error.statusCode).json({
    status: 'error',
    error: {
      ...error,
      message: error.message,
      stack: error.stack,
    },
  });
};

// Send error response for production
const sendErrorProd = (error: AppError, res: Response): void => {
  // Operational, trusted error: send message to client
  if (error.isOperational) {
    res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
    });
  } else {
    // Programming or other unknown error: don't leak error details
    logger.error('Unexpected error:', error);
    
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong!',
    });
  }
};

// Main error handling middleware
export const errorHandler = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let appError = error;

  // Set default values
  appError.statusCode = appError.statusCode || 500;
  appError.status = appError.status || 'error';

  // Log error
  logger.error('Error occurred:', {
    message: error.message,
    statusCode: appError.statusCode,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
  });

  // Handle specific error types
  if (error.code && error.code.startsWith('P2')) {
    appError = handleDatabaseError(error);
  } else if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    appError = handleJWTError(error);
  } else if (error.name === 'ValidationError') {
    appError = handleValidationError(error);
  } else if (error.type === 'entity.parse.failed') {
    appError = new AppError('Invalid JSON in request body', 400);
  } else if (error.code === 'LIMIT_FILE_SIZE') {
    appError = new AppError('File too large', 413);
  } else if (error.code === 'ENOENT') {
    appError = new AppError('File not found', 404);
  }

  // Convert to AppError if not already
  if (!(appError instanceof AppError)) {
    appError = new AppError(appError.message || 'Something went wrong', appError.statusCode || 500);
  }

  // Send error response
  if (config.isDevelopment) {
    sendErrorDev(appError, res);
  } else {
    sendErrorProd(appError, res);
  }
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Create specific error types
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429);
  }
} 