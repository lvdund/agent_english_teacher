import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '@/config/environment';
import { getPrismaClient } from '@/config/database';
import { logger } from '@/utils/logger';
import type { SocketData } from '../types/events';

const prisma = getPrismaClient();

interface JWTPayload {
  id: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  iat: number;
  exp: number;
}

export const authenticateSocket = async (socket: Socket, next: (err?: Error) => void) => {
  try {
    // Extract token from auth header or query parameter
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    
    if (!token) {
      logger.warn('WebSocket connection attempted without token', {
        socketId: socket.id,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
      });
      return next(new Error('Authentication token required'));
    }

    // Verify JWT token
    let decoded: JWTPayload;
    try {
      decoded = jwt.verify(token as string, config.jwt.secret) as JWTPayload;
    } catch (jwtError) {
      logger.warn('Invalid WebSocket JWT token', {
        socketId: socket.id,
        error: jwtError instanceof Error ? jwtError.message : 'Unknown JWT error',
        ip: socket.handshake.address,
      });
      return next(new Error('Invalid authentication token'));
    }

    // Fetch user details from database
    const user = await prisma.user.findUnique({
      where: { 
        id: decoded.id,
        isActive: true, // Only allow active users
      },
      include: {
        memberships: {
          where: { isActive: true },
          select: {
            classId: true,
            role: true,
          },
        },
      },
    });

    if (!user) {
      logger.warn('WebSocket authentication failed - user not found or inactive', {
        userId: decoded.id,
        socketId: socket.id,
        ip: socket.handshake.address,
      });
      return next(new Error('User not found or inactive'));
    }

    // Extract class IDs from memberships
    const classIds = user.memberships.map(membership => membership.classId);

    // Set socket data for use in event handlers
    const socketData: SocketData = {
      userId: user.id,
      userRole: user.role,
      classIds: classIds,
      connectionTime: new Date(),
      lastActivity: new Date(),
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'] || '',
    };

    socket.data = socketData;

    logger.info('WebSocket user authenticated successfully', {
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      socketId: socket.id,
      classIds: classIds,
      ip: socket.handshake.address,
    });

    next();
  } catch (error) {
    logger.error('WebSocket authentication error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      socketId: socket.id,
      ip: socket.handshake.address,
      stack: error instanceof Error ? error.stack : undefined,
    });
    next(new Error('Authentication failed'));
  }
};

export const updateLastActivity = (socket: Socket) => {
  if (socket.data && socket.data.userId) {
    socket.data.lastActivity = new Date();
  }
};

export const requireRole = (allowedRoles: Array<'STUDENT' | 'TEACHER' | 'ADMIN'>) => {
  return (socket: Socket, next: (err?: Error) => void) => {
    const socketData = socket.data as SocketData;
    
    if (!socketData || !socketData.userRole) {
      logger.warn('WebSocket role check failed - no socket data', {
        socketId: socket.id,
        userId: socketData?.userId,
      });
      return next(new Error('User role not found'));
    }

    if (!allowedRoles.includes(socketData.userRole)) {
      logger.warn('WebSocket role check failed - insufficient permissions', {
        socketId: socket.id,
        userId: socketData.userId,
        userRole: socketData.userRole,
        requiredRoles: allowedRoles,
      });
      return next(new Error('Insufficient permissions'));
    }

    next();
  };
};

export const requireClassMembership = (classId: string) => {
  return (socket: Socket, next: (err?: Error) => void) => {
    const socketData = socket.data as SocketData;
    
    if (!socketData || !socketData.userId) {
      return next(new Error('User not authenticated'));
    }

    // Check if user is a member of the class or is an admin
    if (socketData.userRole === 'ADMIN' || socketData.classIds.includes(classId)) {
      return next();
    }

    logger.warn('WebSocket class membership check failed', {
      socketId: socket.id,
      userId: socketData.userId,
      classId: classId,
      userClassIds: socketData.classIds,
    });
    
    return next(new Error('Not a member of this class'));
  };
};

export const validateClassAccess = async (socket: Socket, classId: string): Promise<boolean> => {
  const socketData = socket.data as SocketData;
  
  if (!socketData || !socketData.userId) {
    return false;
  }

  // Admins have access to all classes
  if (socketData.userRole === 'ADMIN') {
    return true;
  }

  // Check if user is a member of the class
  const membership = await prisma.classMembership.findFirst({
    where: {
      userId: socketData.userId,
      classId: classId,
      isActive: true,
    },
  });

  return !!membership;
};

export const isTeacherOrAdmin = (socket: Socket): boolean => {
  const socketData = socket.data as SocketData;
  return socketData?.userRole === 'TEACHER' || socketData?.userRole === 'ADMIN';
};

export const isClassTeacher = async (socket: Socket, classId: string): Promise<boolean> => {
  const socketData = socket.data as SocketData;
  
  if (!socketData || !socketData.userId) {
    return false;
  }

  // Admins have teacher-level access
  if (socketData.userRole === 'ADMIN') {
    return true;
  }

  // Check if user is the teacher of the class
  const classInfo = await prisma.class.findUnique({
    where: { id: classId },
    select: { teacherId: true },
  });

  return classInfo?.teacherId === socketData.userId;
}; 