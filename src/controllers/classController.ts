import { Request, Response } from 'express';
import { getPrismaClient } from '@/config/database';
import { asyncHandler } from '@/middleware/errorHandler';
import { ApiResponse, PaginatedResponse } from '@/types/api';
import { ValidationError, NotFoundError, ConflictError, AuthorizationError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

export class ClassController {
  private readonly prisma = getPrismaClient();

  /**
   * Create a new class (Teachers and Admins only)
   * POST /api/classes
   */
  createClass = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { name, description } = req.body;

    if (!name || name.trim().length < 3) {
      throw new ValidationError('Class name must be at least 3 characters');
    }

    // Generate unique class code
    let code: string;
    let isUnique = false;
    
    do {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const existing = await this.prisma.class.findUnique({ where: { code } });
      isUnique = !existing;
    } while (!isUnique);

    const newClass = await this.prisma.$transaction(async (tx) => {
      // Create the class
      const classData = await tx.class.create({
        data: {
          name: name.trim(),
          description: description?.trim() || '',
          code,
          teacherId: req.user!.id,
        },
      });

      // Add creator as teacher
      await tx.classMembership.create({
        data: {
          userId: req.user!.id,
          classId: classData.id,
          role: 'TEACHER',
          permissions: {
            canSendMessages: true,
            canUploadFiles: true,
            canUseAI: true,
            canManageStudents: true,
            canViewAllChats: true,
            canModerateContent: true,
            canAccessAnalytics: true,
          },
        },
      });

      return classData;
    });

    logger.info('Class created:', {
      classId: newClass.id,
      className: newClass.name,
      createdBy: req.user!.id,
    });

    const response: ApiResponse = {
      status: 'success',
      message: 'Class created successfully',
      data: { class: newClass },
    };

    res.status(201).json(response);
  });

  /**
   * Get all classes (with pagination and filtering)
   * GET /api/classes
   */
  getClasses = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const {
      page = 1,
      limit = 20,
      status,
      search,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Math.min(Number(limit), 50);

    // Build where conditions
    const where: any = {};

    // Filter by status
    if (status && ['ACTIVE', 'INACTIVE'].includes(status as string)) {
      where.status = status;
    }

    // Search by name or description
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    // For teachers, only show classes they're part of
    if (req.user?.role === 'TEACHER') {
      where.memberships = {
        some: {
          userId: req.user.id,
          role: 'TEACHER',
          isActive: true,
        },
      };
    }

    // For students, only show classes they're part of
    if (req.user?.role === 'STUDENT') {
      where.memberships = {
        some: {
          userId: req.user.id,
          isActive: true,
        },
      };
    }

    const [classes, total] = await Promise.all([
      this.prisma.class.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          code: true,
          status: true,
          createdAt: true,
          teacher: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: {
            select: {
              memberships: {
                where: { isActive: true },
              },
              messages: true,
            },
          },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.class.count({ where }),
    ]);

    const response: PaginatedResponse = {
      status: 'success',
      data: { classes },
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
   * Get class by ID
   * GET /api/classes/:id
   */
  getClassById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Class ID is required');
    }

    // Verify user has access to this class
    const membership = await this.prisma.classMembership.findFirst({
      where: {
        classId: id,
        userId: req.user!.id,
        isActive: true,
      },
    });

    if (!membership && req.user?.role !== 'ADMIN') {
      throw new AuthorizationError('You are not a member of this class');
    }

    const classData = await this.prisma.class.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        code: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        memberships: {
          where: { isActive: true },
          select: {
            id: true,
            role: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatar: true,
              },
            },
          },
          orderBy: [
            { role: 'asc' }, // Teachers first
            { joinedAt: 'asc' },
          ],
        },
        _count: {
          select: {
            messages: true,
            memberships: {
              where: { isActive: true },
            },
          },
        },
      },
    });

    if (!classData) {
      throw new NotFoundError('Class not found');
    }

    // Add user's membership info and permissions
    const userMembership = classData.memberships?.find((m: any) => m.user.id === req.user!.id);

    const response: ApiResponse = {
      status: 'success',
      data: {
        class: {
          ...classData,
          userMembership: membership || userMembership,
          memberCount: classData._count?.memberships || 0,
          messageCount: classData._count?.messages || 0,
        },
      },
    };

    res.status(200).json(response);
  });

  /**
   * Join a class using class code
   * POST /api/classes/join
   */
  joinClass = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { classCode } = req.body;

    if (!classCode) {
      throw new ValidationError('Class code is required');
    }

    const classData = await this.prisma.class.findUnique({
      where: { code: classCode.toUpperCase() },
    });

    if (!classData) {
      throw new NotFoundError('Invalid class code');
    }

    if (classData.status !== 'ACTIVE') {
      throw new ValidationError('This class is not accepting new members');
    }

    // Check if user is already a member
    const existingMembership = await this.prisma.classMembership.findFirst({
      where: {
        userId: req.user!.id,
        classId: classData.id,
      },
    });

    if (existingMembership) {
      if (existingMembership.isActive) {
        throw new ConflictError('You are already a member of this class');
      } else {
        // Reactivate membership
        await this.prisma.classMembership.update({
          where: { id: existingMembership.id },
          data: { isActive: true, joinedAt: new Date() },
        });
      }
    } else {
      // Create new membership
      await this.prisma.classMembership.create({
        data: {
          userId: req.user!.id,
          classId: classData.id,
          role: req.user!.role === 'TEACHER' ? 'TEACHER' : 'STUDENT',
          permissions: {
            canSendMessages: true,
            canUploadFiles: true,
            canUseAI: true,
            ...(req.user!.role === 'TEACHER' && {
              canManageStudents: true,
              canViewAllChats: true,
              canModerateContent: true,
              canAccessAnalytics: true,
            }),
          },
        },
      });
    }

    logger.info('User joined class:', {
      userId: req.user!.id,
      classId: classData.id,
      classCode: classData.code,
    });

    const response: ApiResponse = {
      status: 'success',
      message: 'Successfully joined the class',
      data: { class: classData },
    };

    res.status(200).json(response);
  });

  /**
   * Update class details (Teachers only)
   * PUT /api/classes/:id
   */
  updateClass = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { name, description, status } = req.body;

    if (!id) {
      throw new ValidationError('Class ID is required');
    }

    // Verify user is a teacher of this class
    const membership = await this.prisma.classMembership.findFirst({
      where: {
        classId: id,
        userId: req.user!.id,
        role: 'TEACHER',
        isActive: true,
      },
    });

    if (!membership && req.user?.role !== 'ADMIN') {
      throw new AuthorizationError('You are not a teacher of this class');
    }

    // Validate input
    const updateData: any = {};
    if (name !== undefined) {
      if (!name || name.trim().length < 3) {
        throw new ValidationError('Class name must be at least 3 characters');
      }
      updateData.name = name.trim();
    }
    if (description !== undefined) {
      updateData.description = description?.trim() || '';
    }
    if (status !== undefined) {
      if (!['ACTIVE', 'INACTIVE'].includes(status)) {
        throw new ValidationError('Status must be ACTIVE or INACTIVE');
      }
      updateData.status = status;
    }

    const updatedClass = await this.prisma.class.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        description: true,
        code: true,
        status: true,
        updatedAt: true,
      },
    });

    logger.info('Class updated:', {
      classId: id,
      updatedBy: req.user!.id,
      changes: updateData,
    });

    const response: ApiResponse = {
      status: 'success',
      message: 'Class updated successfully',
      data: { class: updatedClass },
    };

    res.status(200).json(response);
  });

  /**
   * Remove user from class (Teachers only)
   * DELETE /api/classes/:id/members/:userId
   */
  removeMember = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id: classId, userId } = req.params;

    if (!classId || !userId) {
      throw new ValidationError('Class ID and User ID are required');
    }

    // Verify user is a teacher of this class
    const teacherMembership = await this.prisma.classMembership.findFirst({
      where: {
        classId,
        userId: req.user!.id,
        role: 'TEACHER',
        isActive: true,
      },
    });

    if (!teacherMembership && req.user?.role !== 'ADMIN') {
      throw new AuthorizationError('You are not a teacher of this class');
    }

    // Find the member to remove
    const memberToRemove = await this.prisma.classMembership.findFirst({
      where: {
        classId,
        userId,
        isActive: true,
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!memberToRemove) {
      throw new NotFoundError('Member not found in this class');
    }

    // Teachers cannot remove other teachers (only admins can)
    if (memberToRemove.role === 'TEACHER' && req.user?.role !== 'ADMIN') {
      throw new AuthorizationError('Only admins can remove teachers from classes');
    }

    // Deactivate membership instead of deleting (for audit trail)
    await this.prisma.classMembership.update({
      where: { id: memberToRemove.id },
      data: { isActive: false },
    });

    logger.info('Member removed from class:', {
      classId,
      removedUserId: userId,
      removedBy: req.user!.id,
    });

    const response: ApiResponse = {
      status: 'success',
      message: `${memberToRemove.user.firstName} ${memberToRemove.user.lastName} has been removed from the class`,
    };

    res.status(200).json(response);
  });

  /**
   * Get class analytics (Teachers only)
   * GET /api/classes/:id/analytics
   */
  getClassAnalytics = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!id) {
      throw new ValidationError('Class ID is required');
    }

    // Verify user is a teacher of this class
    const membership = await this.prisma.classMembership.findFirst({
      where: {
        classId: id,
        userId: req.user!.id,
        role: 'TEACHER',
        isActive: true,
      },
    });

    if (!membership && req.user?.role !== 'ADMIN') {
      throw new AuthorizationError('You are not a teacher of this class');
    }

    // Get analytics data
    const [
      memberStats,
      messageStats,
      aiInteractionStats,
      recentActivity,
    ] = await Promise.all([
      // Member statistics
      this.prisma.classMembership.groupBy({
        by: ['role'],
        where: {
          classId: id,
          isActive: true,
        },
        _count: {
          userId: true,
        },
      }),
      
      // Message statistics
      this.prisma.message.aggregate({
        where: { classId: id },
        _count: { id: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),

      // AI interaction statistics
      this.prisma.aIInteraction.aggregate({
        where: {
          message: { classId: id },
        },
        _count: { id: true },
      }),

      // Recent activity (last 7 days)
      this.prisma.message.findMany({
        where: {
          classId: id,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
          sender: {
            select: {
              firstName: true,
              lastName: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const analytics = {
      members: {
        total: memberStats.reduce((sum, stat) => sum + stat._count.userId, 0),
        byRole: memberStats.reduce((acc, stat) => {
          acc[stat.role.toLowerCase()] = stat._count.userId;
          return acc;
        }, {} as Record<string, number>),
      },
      messages: {
        total: messageStats._count.id,
        firstMessage: messageStats._min.createdAt,
        lastMessage: messageStats._max.createdAt,
      },
      aiInteractions: {
        total: aiInteractionStats._count.id,
      },
      recentActivity,
    };

    const response: ApiResponse = {
      status: 'success',
      data: { analytics },
    };

    res.status(200).json(response);
  });
}

// Export singleton instance
export const classController = new ClassController(); 