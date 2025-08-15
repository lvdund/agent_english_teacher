import { Socket } from 'socket.io';
import { logger } from '@/utils/logger';
import { enhancedAuth } from './authEnhanced';
import type { SocketData } from '../types/events';

export interface PermissionCheck {
  permission: string;
  context?: {
    classId?: string;
    resourceId?: string;
    resourceType?: 'message' | 'class' | 'user';
  };
}

export class WebSocketAuthorization {
  // Role hierarchy for permission inheritance
  private static readonly ROLE_HIERARCHY = {
    ADMIN: ['ADMIN', 'TEACHER', 'STUDENT'],
    TEACHER: ['TEACHER', 'STUDENT'],
    STUDENT: ['STUDENT'],
  };

  // Permission definitions
  private static readonly PERMISSIONS = {
    // Message permissions
    'message:send': ['STUDENT', 'TEACHER', 'ADMIN'],
    'message:edit_own': ['STUDENT', 'TEACHER', 'ADMIN'],
    'message:edit_any': ['TEACHER', 'ADMIN'],
    'message:delete_own': ['STUDENT', 'TEACHER', 'ADMIN'],
    'message:delete_any': ['TEACHER', 'ADMIN'],
    'message:moderate': ['TEACHER', 'ADMIN'],

    // Typing permissions
    'typing:send': ['STUDENT', 'TEACHER', 'ADMIN'],

    // Presence permissions
    'presence:update': ['STUDENT', 'TEACHER', 'ADMIN'],
    'presence:view': ['STUDENT', 'TEACHER', 'ADMIN'],

    // Class permissions
    'class:join': ['STUDENT', 'TEACHER', 'ADMIN'],
    'class:leave': ['STUDENT', 'TEACHER', 'ADMIN'],
    'class:create': ['TEACHER', 'ADMIN'],
    'class:manage': ['TEACHER', 'ADMIN'],
    'class:moderate': ['TEACHER', 'ADMIN'],
    'class:view_analytics': ['TEACHER', 'ADMIN'],

    // User management permissions
    'user:manage': ['ADMIN'],
    'user:view_profile': ['STUDENT', 'TEACHER', 'ADMIN'],
    'user:search': ['TEACHER', 'ADMIN'],

    // System permissions
    'system:broadcast': ['ADMIN'],
    'system:maintenance': ['ADMIN'],

    // Notification permissions
    'notification:send': ['TEACHER', 'ADMIN'],
    'notification:manage': ['ADMIN'],
  };

  /**
   * Check if user has required permission
   */
  public static hasPermission(
    socket: Socket, 
    permission: string, 
    context?: PermissionCheck['context']
  ): boolean {
    const socketData = socket.data as SocketData;
    if (!socketData) {
      logger.warn('Authorization check failed - no socket data', { permission });
      return false;
    }

    const session = enhancedAuth.getSession(socket.id);
    if (!session) {
      logger.warn('Authorization check failed - no session', { 
        permission, 
        userId: socketData.userId 
      });
      return false;
    }

    // Check base permission from role
    if (!this.hasRolePermission(socketData.userRole, permission)) {
      return false;
    }

    // Check context-specific permissions
    if (context) {
      return this.checkContextPermission(socket, permission, context);
    }

    return true;
  }

  /**
   * Check if role has base permission
   */
  private static hasRolePermission(role: string, permission: string): boolean {
    const allowedRoles = this.PERMISSIONS[permission as keyof typeof this.PERMISSIONS];
    if (!allowedRoles) {
      logger.warn('Unknown permission checked', { permission, role });
      return false;
    }

    return allowedRoles.includes(role);
  }

  /**
   * Check context-specific permissions (e.g., class membership, resource ownership)
   */
  private static checkContextPermission(
    socket: Socket, 
    permission: string, 
    context: PermissionCheck['context']
  ): boolean {
    const socketData = socket.data as SocketData;
    const session = enhancedAuth.getSession(socket.id);

    if (!session) return false;

    // Class-specific permissions
    if (context?.classId) {
      // Check if user is member of the class
      if (!socketData.classIds.includes(context.classId)) {
        logger.warn('Class permission denied - not a member', {
          userId: socketData.userId,
          classId: context.classId,
          permission,
        });
        return false;
      }

      // Check class-specific permissions from session
      const classPermissionKey = `class:${context.classId}:${permission.split(':')[1]}`;
      if (session.permissions[classPermissionKey] !== undefined) {
        return session.permissions[classPermissionKey];
      }
    }

    // Resource ownership checks - simplified for now
    if (context?.resourceType && context?.resourceId) {
      // For now, implement basic ownership rules
      // This would typically involve database queries in a real implementation
      
      switch (context.resourceType) {
        case 'message':
          // Users can edit/delete their own messages
          if (permission.includes('_own')) {
            // This would require a database query to check message ownership
            // For now, we'll implement this in the actual message handlers
            return true;
          }
          break;
          
        case 'user':
          // Users can view/edit their own profile
          if (permission.includes('profile') && context.resourceId === socketData.userId) {
            return true;
          }
          break;
      }
      
      return false;
    }

    return true;
  }

  /**
   * Check if user owns or can access a specific resource
   */
  private static checkResourceOwnership(
    socket: Socket, 
    permission: string, 
    context: { resourceType: string; resourceId: string; classId?: string }
  ): boolean {
    const socketData = socket.data as SocketData;
    
    // For now, implement basic ownership rules
    // This would typically involve database queries in a real implementation
    
    switch (context.resourceType) {
      case 'message':
        // Users can edit/delete their own messages
        if (permission.includes('_own')) {
          // This would require a database query to check message ownership
          // For now, we'll implement this in the actual message handlers
          return true;
        }
        break;
        
      case 'user':
        // Users can view/edit their own profile
        if (permission.includes('profile') && context.resourceId === socketData.userId) {
          return true;
        }
        break;
    }

    return false;
  }

  /**
   * Middleware factory for specific permissions
   */
  public static requirePermission(permission: string, context?: PermissionCheck['context']) {
    return (socket: Socket, next: (err?: Error) => void) => {
      if (this.hasPermission(socket, permission, context)) {
        next();
      } else {
        const socketData = socket.data as SocketData;
        
        logger.warn('WebSocket permission denied', {
          userId: socketData?.userId,
          userRole: socketData?.userRole,
          permission,
          context,
          socketId: socket.id,
        });

        // Emit authorization error to client
        socket.emit('auth:error', {
          reason: 'insufficient_permissions',
          message: `Permission denied: ${permission}`,
          timestamp: new Date(),
        });

        next(new Error(`Permission denied: ${permission}`));
      }
    };
  }

  /**
   * Check multiple permissions (user must have ALL)
   */
  public static requireAllPermissions(permissions: string[], context?: PermissionCheck['context']) {
    return (socket: Socket, next: (err?: Error) => void) => {
      const missingPermissions = permissions.filter(
        permission => !this.hasPermission(socket, permission, context)
      );

      if (missingPermissions.length === 0) {
        next();
      } else {
        const socketData = socket.data as SocketData;
        
        logger.warn('WebSocket multiple permissions denied', {
          userId: socketData?.userId,
          userRole: socketData?.userRole,
          missingPermissions,
          context,
          socketId: socket.id,
        });

        socket.emit('auth:error', {
          reason: 'insufficient_permissions',
          message: `Missing permissions: ${missingPermissions.join(', ')}`,
          timestamp: new Date(),
        });

        next(new Error(`Missing permissions: ${missingPermissions.join(', ')}`));
      }
    };
  }

  /**
   * Check any of multiple permissions (user must have AT LEAST ONE)
   */
  public static requireAnyPermission(permissions: string[], context?: PermissionCheck['context']) {
    return (socket: Socket, next: (err?: Error) => void) => {
      const hasAnyPermission = permissions.some(
        permission => this.hasPermission(socket, permission, context)
      );

      if (hasAnyPermission) {
        next();
      } else {
        const socketData = socket.data as SocketData;
        
        logger.warn('WebSocket alternative permissions denied', {
          userId: socketData?.userId,
          userRole: socketData?.userRole,
          requiredPermissions: permissions,
          context,
          socketId: socket.id,
        });

        socket.emit('auth:error', {
          reason: 'insufficient_permissions',
          message: `Requires one of: ${permissions.join(', ')}`,
          timestamp: new Date(),
        });

        next(new Error(`Requires one of: ${permissions.join(', ')}`));
      }
    };
  }

  /**
   * Class membership requirement
   */
  public static requireClassMembership(classId?: string) {
    return (socket: Socket, next: (err?: Error) => void) => {
      const socketData = socket.data as SocketData;
      
      if (!socketData) {
        return next(new Error('User not authenticated'));
      }

      // If classId is provided, check specific class membership
      if (classId) {
        if (socketData.userRole === 'ADMIN' || socketData.classIds.includes(classId)) {
          return next();
        } else {
          logger.warn('Class membership required', {
            userId: socketData.userId,
            classId,
            userClassIds: socketData.classIds,
            socketId: socket.id,
          });
          
          socket.emit('auth:error', {
            reason: 'insufficient_permissions',
            message: 'Class membership required',
            timestamp: new Date(),
          });
          
          return next(new Error('Class membership required'));
        }
      }

      // If no classId provided, user just needs to be in at least one class
      if (socketData.classIds.length > 0 || socketData.userRole === 'ADMIN') {
        next();
      } else {
        socket.emit('auth:error', {
          reason: 'insufficient_permissions',
          message: 'Must be member of at least one class',
          timestamp: new Date(),
        });
        
        next(new Error('Must be member of at least one class'));
      }
    };
  }

  /**
   * Teacher or Admin role requirement
   */
  public static requireTeacherOrAdmin() {
    return (socket: Socket, next: (err?: Error) => void) => {
      const socketData = socket.data as SocketData;
      
      if (!socketData) {
        return next(new Error('User not authenticated'));
      }

      if (socketData.userRole === 'TEACHER' || socketData.userRole === 'ADMIN') {
        next();
      } else {
        logger.warn('Teacher or Admin role required', {
          userId: socketData.userId,
          userRole: socketData.userRole,
          socketId: socket.id,
        });

        socket.emit('auth:error', {
          reason: 'insufficient_permissions',
          message: 'Teacher or Admin role required',
          timestamp: new Date(),
        });

        next(new Error('Teacher or Admin role required'));
      }
    };
  }

  /**
   * Admin only requirement
   */
  public static requireAdmin() {
    return (socket: Socket, next: (err?: Error) => void) => {
      const socketData = socket.data as SocketData;
      
      if (!socketData) {
        return next(new Error('User not authenticated'));
      }

      if (socketData.userRole === 'ADMIN') {
        next();
      } else {
        logger.warn('Admin role required', {
          userId: socketData.userId,
          userRole: socketData.userRole,
          socketId: socket.id,
        });

        socket.emit('auth:error', {
          reason: 'insufficient_permissions',
          message: 'Admin role required',
          timestamp: new Date(),
        });

        next(new Error('Admin role required'));
      }
    };
  }

  /**
   * Dynamic permission checker that extracts context from event data
   */
  public static dynamicPermissionCheck(
    permissionExtractor: (data: any) => { permission: string; context?: PermissionCheck['context'] }
  ) {
    return (socket: Socket, next: (err?: Error) => void) => {
      // This would be called with event data in the actual event handler
      // For now, we'll store the extractor function for later use
      (socket as any).permissionExtractor = permissionExtractor;
      next();
    };
  }

  /**
   * Check permission with event data
   */
  public static checkEventPermission(
    socket: Socket, 
    eventData: any, 
    permissionExtractor: (data: any) => { permission: string; context?: PermissionCheck['context'] }
  ): boolean {
    try {
      const { permission, context } = permissionExtractor(eventData);
      return this.hasPermission(socket, permission, context);
    } catch (error) {
      logger.error('Permission extraction failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        eventData,
      });
      return false;
    }
  }

  /**
   * Get user's effective permissions
   */
  public static getUserPermissions(socket: Socket): string[] {
    const socketData = socket.data as SocketData;
    const session = enhancedAuth.getSession(socket.id);
    
    if (!socketData || !session) {
      return [];
    }

    const rolePermissions = Object.entries(this.PERMISSIONS)
      .filter(([_, roles]) => roles.includes(socketData.userRole))
      .map(([permission]) => permission);

    const sessionPermissions = Object.keys(session.permissions)
      .filter(key => session.permissions[key]);

    return [...new Set([...rolePermissions, ...sessionPermissions])];
  }

  /**
   * Get authorization statistics
   */
  public static getAuthStats(): {
    totalPermissions: number;
    roleHierarchy: typeof WebSocketAuthorization.ROLE_HIERARCHY;
    permissionsByRole: Record<string, string[]>;
  } {
    const permissionsByRole: Record<string, string[]> = {};
    
    for (const role of ['ADMIN', 'TEACHER', 'STUDENT']) {
      permissionsByRole[role] = Object.entries(this.PERMISSIONS)
        .filter(([_, roles]) => roles.includes(role))
        .map(([permission]) => permission);
    }

    return {
      totalPermissions: Object.keys(this.PERMISSIONS).length,
      roleHierarchy: this.ROLE_HIERARCHY,
      permissionsByRole,
    };
  }
}

// Export convenience functions
export const requirePermission = WebSocketAuthorization.requirePermission;
export const requireAllPermissions = WebSocketAuthorization.requireAllPermissions;
export const requireAnyPermission = WebSocketAuthorization.requireAnyPermission;
export const requireClassMembership = WebSocketAuthorization.requireClassMembership;
export const requireTeacherOrAdmin = WebSocketAuthorization.requireTeacherOrAdmin;
export const requireAdmin = WebSocketAuthorization.requireAdmin;
export const hasPermission = WebSocketAuthorization.hasPermission;
export const checkEventPermission = WebSocketAuthorization.checkEventPermission; 