import { Request, Response, NextFunction } from 'express';
import { getPrismaClient } from '@/config/database';
import { loggers } from '@/utils/logger';
import { AuthorizationError, AuthenticationError } from '@/middleware/errorHandler';

type UserRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

/**
 * Role-based authorization middleware
 * @param allowedRoles - Array of roles that can access the endpoint
 */
export const authorize = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      // Check if user role is allowed
      if (!allowedRoles.includes(req.user.role)) {
        loggers.security.unauthorized(
          req.ip || 'unknown',
          req.originalUrl,
          `Role ${req.user.role} not allowed`
        );
        throw new AuthorizationError(`Access denied. Required roles: ${allowedRoles.join(', ')}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Class membership authorization middleware
 * Checks if user is a member of the specified class
 * @param getClassId - Function to extract class ID from request (params, body, etc.)
 */
export const authorizeClassMember = (
  getClassId: (req: Request) => string
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const classId = getClassId(req);
      
      if (!classId) {
        throw new AuthorizationError('Class ID required');
      }

      // Check if user is a member of the class
      const isClassMember = req.user.classIds?.includes(classId);
      
      if (!isClassMember) {
        const prisma = getPrismaClient();
        
        // Double-check with database in case classIds are stale
        const membership = await prisma.classMembership.findFirst({
          where: {
            userId: req.user.id,
            classId: classId,
            isActive: true,
          },
        });

        if (!membership) {
          loggers.security.unauthorized(
            req.ip || 'unknown',
            req.originalUrl,
            `User ${req.user.id} not member of class ${classId}`
          );
          throw new AuthorizationError('You are not a member of this class');
        }

        // Update user's classIds if membership found
        if (!req.user.classIds) {
          req.user.classIds = [classId];
        } else {
          req.user.classIds.push(classId);
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Class teacher authorization middleware
 * Checks if user is a teacher of the specified class
 */
export const authorizeClassTeacher = (
  getClassId: (req: Request) => string
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      if (req.user.role !== 'TEACHER' && req.user.role !== 'ADMIN') {
        throw new AuthorizationError('Teacher access required');
      }

      const classId = getClassId(req);
      
      if (!classId) {
        throw new AuthorizationError('Class ID required');
      }

      const prisma = getPrismaClient();

      // Check if user is teacher of the class
      const membership = await prisma.classMembership.findFirst({
        where: {
          userId: req.user.id,
          classId: classId,
          role: 'TEACHER',
          isActive: true,
        },
      });

      // Admins can access any class
      if (!membership && req.user.role !== 'ADMIN') {
        loggers.security.unauthorized(
          req.ip || 'unknown',
          req.originalUrl,
          `User ${req.user.id} not teacher of class ${classId}`
        );
        throw new AuthorizationError('You are not a teacher of this class');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Resource owner authorization middleware
 * Checks if user owns the specified resource
 */
export const authorizeResourceOwner = (
  getResourceOwnerId: (req: Request) => Promise<string | null>
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      const resourceOwnerId = await getResourceOwnerId(req);
      
      if (!resourceOwnerId) {
        throw new AuthorizationError('Resource not found');
      }

      // Allow if user owns the resource or is admin
      if (req.user.id !== resourceOwnerId && req.user.role !== 'ADMIN') {
        loggers.security.unauthorized(
          req.ip || 'unknown',
          req.originalUrl,
          `User ${req.user.id} not owner of resource owned by ${resourceOwnerId}`
        );
        throw new AuthorizationError('You can only access your own resources');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Admin only authorization middleware
 */
export const adminOnly = authorize(['ADMIN']);

/**
 * Teacher and admin authorization middleware
 */
export const teacherOrAdmin = authorize(['TEACHER', 'ADMIN']);

/**
 * Student, teacher, and admin authorization middleware (basically any authenticated user)
 */
export const anyRole = authorize(['STUDENT', 'TEACHER', 'ADMIN']);

/**
 * Helper functions for common class ID extraction patterns
 */
export const classIdFromParams = (req: Request): string => req.params.classId || req.params.id || '';
export const classIdFromBody = (req: Request): string => req.body.classId || '';
export const classIdFromQuery = (req: Request): string => req.query.classId as string || '';

/**
 * Helper function for message owner authorization
 */
export const getMessageOwnerId = async (req: Request): Promise<string | null> => {
  const messageId = req.params.messageId || req.params.id;
  
  if (!messageId) {
    return null;
  }

  const prisma = getPrismaClient();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true },
  });

  return message?.senderId || null;
};

/**
 * Helper function for user profile owner authorization
 */
export const getUserOwnerId = async (req: Request): Promise<string | null> => {
  const userId = req.params.userId || req.params.id;
  
  // If no userId in params, assume current user
  return userId || req.user?.id || null;
}; 