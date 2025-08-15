import { Request, Response, NextFunction } from 'express';
import { tokenService } from '@/services/tokenService';
import { loggers } from '@/utils/logger';
import { AuthenticationError } from '@/middleware/errorHandler';

/**
 * Authentication middleware - verifies JWT token and populates req.user
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    const token = tokenService.extractTokenFromHeader(authHeader);

    if (!token) {
      throw new AuthenticationError('Authentication token required');
    }

    // Get user from token
    const user = await tokenService.getUserFromToken(token);

    if (!user) {
      throw new AuthenticationError('Invalid or expired token');
    }

    // Populate req.user with user information
    const userInfo: typeof req.user = {
      id: user.userId,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
    };
    
    if (user.classIds) {
      userInfo.classIds = user.classIds;
    }
    
    req.user = userInfo;

    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      loggers.security.unauthorized(req.ip || 'unknown', req.originalUrl, error.message);
    }
    next(error);
  }
};

/**
 * Optional authentication middleware - doesn't throw error if no token
 * Useful for endpoints that work for both authenticated and unauthenticated users
 */
export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = tokenService.extractTokenFromHeader(authHeader);

    if (token) {
      const user = await tokenService.getUserFromToken(token);
      
      if (user) {
        const userInfo: typeof req.user = {
          id: user.userId,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
        };
        
        if (user.classIds) {
          userInfo.classIds = user.classIds;
        }
        
        req.user = userInfo;
      }
    }

    // Always continue, regardless of token validity
    next();
  } catch (error) {
    // Log error but don't fail the request
    loggers.security.unauthorized(req.ip || 'unknown', req.originalUrl, 'Optional auth failed');
    next();
  }
}; 