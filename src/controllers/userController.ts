import { Request, Response } from 'express';
import { getPrismaClient } from '@/config/database';
import { asyncHandler } from '@/middleware/errorHandler';
import { ApiResponse, PaginatedResponse, SearchQuery } from '@/types/api';
import { ValidationError, NotFoundError, AuthorizationError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

export class UserController {
  private readonly prisma = getPrismaClient();

  /**
   * Get current user profile
   * GET /api/users/profile
   */
  getProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new ValidationError('User not authenticated');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        avatar: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          where: { isActive: true },
          select: {
            id: true,
            role: true,
            permissions: true,
            joinedAt: true,
            class: {
              select: {
                id: true,
                name: true,
                description: true,
                code: true,
                status: true,
              },
            },
          },
        },
        _count: {
          select: {
            sentMessages: true,
            aiInteractions: true,
            examSubmissions: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const response: ApiResponse = {
      status: 'success',
      data: {
        user: {
          ...user,
          stats: user._count,
        },
      },
    };

    res.status(200).json(response);
  });

  /**
   * Update user profile
   * PUT /api/users/profile
   */
  updateProfile = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new ValidationError('User not authenticated');
    }

    const { firstName, lastName, avatar, preferences } = req.body;

    // Validate input
    if (firstName && firstName.trim().length < 2) {
      throw new ValidationError('First name must be at least 2 characters');
    }
    if (lastName && lastName.trim().length < 2) {
      throw new ValidationError('Last name must be at least 2 characters');
    }

    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName.trim();
    if (lastName !== undefined) updateData.lastName = lastName.trim();
    if (avatar !== undefined) updateData.avatar = avatar;
    if (preferences !== undefined) updateData.preferences = preferences;

    const updatedUser = await this.prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        avatar: true,
        preferences: true,
        updatedAt: true,
      },
    });

    const response: ApiResponse = {
      status: 'success',
      message: 'Profile updated successfully',
      data: { user: updatedUser },
    };

    res.status(200).json(response);
  });

  /**
   * Get user by ID (Admin/Teacher only or own profile)
   * GET /api/users/:id
   */
  getUserById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!req.user) {
      throw new ValidationError('User not authenticated');
    }

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    // Check if user can view other user's profile
    if (req.user.id !== id && req.user.role !== 'ADMIN' && req.user.role !== 'TEACHER') {
      throw new AuthorizationError('You can only view your own profile');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        // Include class memberships for teachers viewing students
        ...(req.user.role === 'TEACHER' || req.user.role === 'ADMIN'
          ? {
              memberships: {
                where: { isActive: true },
                select: {
                  id: true,
                  role: true,
                  joinedAt: true,
                  class: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                    },
                  },
                },
              },
              _count: {
                select: {
                  sentMessages: true,
                  aiInteractions: true,
                  examSubmissions: true,
                },
              },
            }
          : {}),
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // If teacher, verify they share at least one class with the user
    if (req.user.role === 'TEACHER' && req.user.id !== id) {
      const sharedClasses = await this.prisma.classMembership.findFirst({
        where: {
          AND: [
            { userId: id },
            {
              class: {
                memberships: {
                  some: {
                    userId: req.user.id,
                    role: 'TEACHER',
                    isActive: true,
                  },
                },
              },
            },
          ],
        },
      });

      if (!sharedClasses) {
        throw new AuthorizationError('You can only view students from your classes');
      }
    }

    const response: ApiResponse = {
      status: 'success',
      data: { user },
    };

    res.status(200).json(response);
  });

  /**
   * Search users (Admin/Teacher only)
   * GET /api/users/search
   */
  searchUsers = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new ValidationError('User not authenticated');
    }

    if (req.user.role !== 'ADMIN' && req.user.role !== 'TEACHER') {
      throw new AuthorizationError('Only teachers and admins can search users');
    }

    const {
      q = '',
      role,
      classId,
      isActive,
      page = 1,
      limit = 20,
    } = req.query as SearchQuery;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Math.min(Number(limit), 50); // Max 50 users per page

    // Build search conditions
    const where: any = {};

    // Text search in name and email
    if (q.trim()) {
      where.OR = [
        { firstName: { contains: q.trim(), mode: 'insensitive' } },
        { lastName: { contains: q.trim(), mode: 'insensitive' } },
        { email: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }

    // Filter by role
    if (role && ['STUDENT', 'TEACHER', 'ADMIN'].includes(role as string)) {
      where.role = role;
    }

    // Filter by active status
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }

    // Filter by class (for teachers - only their classes)
    if (classId) {
      if (req.user.role === 'TEACHER') {
        // Verify teacher has access to this class
        const teacherMembership = await this.prisma.classMembership.findFirst({
          where: {
            userId: req.user.id,
            classId: classId as string,
            role: 'TEACHER',
            isActive: true,
          },
        });

        if (!teacherMembership) {
          throw new AuthorizationError('You can only search users from your classes');
        }
      }

      where.memberships = {
        some: {
          classId: classId as string,
          isActive: true,
        },
      };
    } else if (req.user.role === 'TEACHER') {
      // Teachers can only see users from their classes
      where.memberships = {
        some: {
          class: {
            memberships: {
              some: {
                userId: req.user.id,
                role: 'TEACHER',
                isActive: true,
              },
            },
          },
        },
      };
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          avatar: true,
          createdAt: true,
          memberships: {
            where: { isActive: true },
            select: {
              role: true,
              class: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
            },
          },
        },
        skip,
        take,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.user.count({ where }),
    ]);

    const response: PaginatedResponse = {
      status: 'success',
      data: { users },
      pagination: {
        page: Number(page),
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    };

    res.status(200).json(response);
  });

  /**
   * Update user status (Admin only)
   * PATCH /api/users/:id/status
   */
  updateUserStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { isActive } = req.body;

    if (!id) {
      throw new ValidationError('User ID is required');
    }

    if (typeof isActive !== 'boolean') {
      throw new ValidationError('isActive must be a boolean value');
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Prevent admins from deactivating themselves
    if (req.user?.id === id && !isActive) {
      throw new ValidationError('You cannot deactivate your own account');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    // If deactivating, revoke all user's tokens
    if (!isActive) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id },
        data: { isRevoked: true },
      });
    }

    logger.info('User status updated:', {
      adminId: req.user?.id,
      targetUserId: id,
      newStatus: isActive,
    });

    const response: ApiResponse = {
      status: 'success',
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: { user: updatedUser },
    };

    res.status(200).json(response);
  });

  /**
   * Get user's classes
   * GET /api/users/classes
   */
  getUserClasses = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      throw new ValidationError('User not authenticated');
    }

    const memberships = await this.prisma.classMembership.findMany({
      where: {
        userId: req.user.id,
        isActive: true,
      },
      select: {
        id: true,
        role: true,
        permissions: true,
        joinedAt: true,
        class: {
          select: {
            id: true,
            name: true,
            description: true,
            code: true,
            status: true,
            createdAt: true,
            _count: {
              select: {
                memberships: {
                  where: { isActive: true },
                },
                messages: true,
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const classes = memberships.map((membership) => ({
      membershipId: membership.id,
      role: membership.role,
      permissions: membership.permissions,
      joinedAt: membership.joinedAt,
      ...membership.class,
      memberCount: membership.class._count.memberships,
      messageCount: membership.class._count.messages,
    }));

    const response: ApiResponse = {
      status: 'success',
      data: { classes },
    };

    res.status(200).json(response);
  });
}

// Export singleton instance
export const userController = new UserController(); 