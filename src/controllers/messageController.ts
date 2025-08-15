import { Request, Response } from 'express';
import { getPrismaClient } from '@/config/database';
import { logger } from '@/utils/logger';
import { 
  ValidationError, 
  AuthorizationError, 
  NotFoundError,
  ConflictError 
} from '@/middleware/errorHandler';
import type { PaginatedResponse } from '@/types/api';

const prisma = getPrismaClient();

interface MessageResponse {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  parentId: string | null;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  attachments?: {
    id: string;
    filename: string;
    url: string;
    mimetype: string;
    size: number;
  }[];
  replies?: MessageResponse[];
  _count?: {
    replies: number;
  };
}

interface CreateMessageRequest {
  content: string;
  parentId?: string;
}

interface UpdateMessageRequest {
  content: string;
}

/**
 * Get messages for a specific class with pagination and optional thread support
 * GET /api/classes/:classId/messages
 */
export const getClassMessages = async (req: Request, res: Response): Promise<void> => {
  const { classId } = req.params;
  const { 
    page = '1', 
    limit = '20', 
    parentId,
    includeReplies = 'false'
  } = req.query as {
    page?: string;
    limit?: string;
    parentId?: string;
    includeReplies?: string;
  };

  if (!classId) {
    throw new ValidationError('Class ID is required');
  }

  // Verify user is a member of the class
  const membership = await prisma.classMembership.findFirst({
    where: {
      classId,
      userId: req.user!.id,
      isActive: true,
    },
  });

  if (!membership) {
    throw new AuthorizationError('You are not a member of this class');
  }

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause based on parentId filter
  const whereClause: any = {
    classId,
  };

  if (parentId) {
    whereClause.parentMessageId = parentId;
  } else {
    // Only get top-level messages (no parent) unless parentId is specified
    whereClause.parentMessageId = null;
  }

  const [messages, totalCount] = await Promise.all([
    prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        attachments: {
          select: {
            id: true,
            filename: true,
            url: true,
            mimetype: true,
            size: true,
          },
        },
        ...(includeReplies === 'true' && {
          replies: {
            include: {
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: true,
                },
              },
              attachments: {
                select: {
                  id: true,
                  filename: true,
                  url: true,
                  mimetype: true,
                  size: true,
                },
              },
              _count: {
                select: {
                  replies: true,
                },
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        }),
        _count: {
          select: {
            replies: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limitNum,
    }),
    prisma.message.count({
      where: whereClause,
    }),
  ]);

  const totalPages = Math.ceil(totalCount / limitNum);
  const hasNext = pageNum < totalPages;
  const hasPrev = pageNum > 1;

  // Transform messages to match MessageResponse interface
  const transformedMessages: MessageResponse[] = messages.map(message => ({
    id: message.id,
    content: message.content,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    parentId: message.parentMessageId,
    author: {
      id: message.sender.id,
      firstName: message.sender.firstName,
      lastName: message.sender.lastName,
      role: message.sender.role,
    },
    attachments: message.attachments?.map(att => ({
      id: att.id,
      filename: att.filename,
      url: att.url,
      mimetype: att.mimetype,
      size: att.size,
    })),
    replies: (message as any).replies?.map((reply: any) => ({
      id: reply.id,
      content: reply.content,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
      parentId: reply.parentMessageId,
      author: {
        id: reply.sender.id,
        firstName: reply.sender.firstName,
        lastName: reply.sender.lastName,
        role: reply.sender.role,
      },
      attachments: reply.attachments?.map((att: any) => ({
        id: att.id,
        filename: att.filename,
        url: att.url,
        mimetype: att.mimetype,
        size: att.size,
      })),
      _count: reply._count,
    })),
    _count: message._count,
  }));

  const response: PaginatedResponse<MessageResponse[]> = {
    status: 'success',
    data: transformedMessages,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalCount,
      pages: totalPages,
    },
  };

  logger.info(`Retrieved ${messages.length} messages for class ${classId}`, {
    userId: req.user!.id,
    classId,
    page: pageNum,
    limit: limitNum,
  });

  res.json(response);
};

/**
 * Create a new message in a class
 * POST /api/classes/:classId/messages
 */
export const createMessage = async (req: Request, res: Response): Promise<void> => {
  const { classId } = req.params;
  const { content, parentId } = req.body as CreateMessageRequest;

  if (!classId) {
    throw new ValidationError('Class ID is required');
  }

  if (!content || content.trim().length === 0) {
    throw new ValidationError('Message content is required');
  }

  if (content.trim().length > 5000) {
    throw new ValidationError('Message content cannot exceed 5000 characters');
  }

  // Verify user is a member of the class
  const membership = await prisma.classMembership.findFirst({
    where: {
      classId,
      userId: req.user!.id,
      isActive: true,
    },
  });

  if (!membership) {
    throw new AuthorizationError('You are not a member of this class');
  }

  // If replying to a message, verify the parent message exists and belongs to this class
  if (parentId) {
    const parentMessage = await prisma.message.findFirst({
      where: {
        id: parentId,
        classId,
      },
    });

    if (!parentMessage) {
      throw new NotFoundError('Parent message not found in this class');
    }
  }

  const message = await prisma.message.create({
    data: {
      content: content.trim(),
      classId,
      senderId: req.user!.id,
      parentMessageId: parentId || null,
    },
    include: {
      sender: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      attachments: {
        select: {
          id: true,
          filename: true,
          url: true,
          mimetype: true,
          size: true,
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  logger.info(`Message created in class ${classId}`, {
    messageId: message.id,
    authorId: req.user!.id,
    classId,
    parentId: parentId || null,
  });

  res.status(201).json(message);
};

/**
 * Get a specific message with its thread (replies)
 * GET /api/messages/:messageId/thread
 */
export const getMessageThread = async (req: Request, res: Response): Promise<void> => {
  const { messageId } = req.params;

  if (!messageId) {
    throw new ValidationError('Message ID is required');
  }

  const message = await prisma.message.findUnique({
    where: {
      id: messageId,
    },
    include: {
      sender: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      attachments: {
        select: {
          id: true,
          filename: true,
          url: true,
          mimetype: true,
          size: true,
        },
      },
      replies: {
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          attachments: {
            select: {
              id: true,
              filename: true,
              url: true,
              mimetype: true,
              size: true,
            },
          },
          _count: {
            select: {
              replies: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  if (!message) {
    throw new NotFoundError('Message not found');
  }

  // Verify user is a member of the class
  const membership = await prisma.classMembership.findFirst({
    where: {
      classId: message.classId,
      userId: req.user!.id,
      isActive: true,
    },
  });

  if (!membership) {
    throw new AuthorizationError('You are not a member of this class');
  }

  logger.info(`Retrieved message thread for message ${messageId}`, {
    userId: req.user!.id,
    messageId,
    classId: message.classId,
  });

  res.json(message);
};

/**
 * Update a message (only by author or teacher/admin)
 * PUT /api/messages/:messageId
 */
export const updateMessage = async (req: Request, res: Response): Promise<void> => {
  const { messageId } = req.params;
  const { content } = req.body as UpdateMessageRequest;

  if (!messageId) {
    throw new ValidationError('Message ID is required');
  }

  if (!content || content.trim().length === 0) {
    throw new ValidationError('Message content is required');
  }

  if (content.trim().length > 5000) {
    throw new ValidationError('Message content cannot exceed 5000 characters');
  }

  const message = await prisma.message.findUnique({
    where: {
      id: messageId,
    },
    include: {
      class: {
        select: {
          teacherId: true,
        },
      },
    },
  });

  if (!message) {
    throw new NotFoundError('Message not found');
  }

  // Verify user is a member of the class
  const membership = await prisma.classMembership.findFirst({
    where: {
      classId: message.classId,
      userId: req.user!.id,
      isActive: true,
    },
  });

  if (!membership) {
    throw new AuthorizationError('You are not a member of this class');
  }

  // Only allow message author, class teacher, or admin to update
  const isAuthor = message.senderId === req.user!.id;
  const isClassTeacher = message.class.teacherId === req.user!.id;
  const isAdmin = req.user!.role === 'ADMIN';

  if (!isAuthor && !isClassTeacher && !isAdmin) {
    throw new AuthorizationError('You can only edit your own messages');
  }

  // Check if message is too old to edit (24 hours for students, no limit for teachers/admins)
  if (req.user!.role === 'STUDENT') {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (message.createdAt < twentyFourHoursAgo && !isClassTeacher && !isAdmin) {
      throw new ConflictError('Messages can only be edited within 24 hours');
    }
  }

  const updatedMessage = await prisma.message.update({
    where: {
      id: messageId,
    },
    data: {
      content: content.trim(),
      updatedAt: new Date(),
    },
    include: {
      sender: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      attachments: {
        select: {
          id: true,
          filename: true,
          url: true,
          mimetype: true,
          size: true,
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  logger.info(`Message updated: ${messageId}`, {
    messageId,
    editorId: req.user!.id,
    authorId: message.senderId,
    classId: message.classId,
  });

  res.json(updatedMessage);
};

/**
 * Delete a message (only by author or teacher/admin)
 * DELETE /api/messages/:messageId
 */
export const deleteMessage = async (req: Request, res: Response): Promise<void> => {
  const { messageId } = req.params;

  if (!messageId) {
    throw new ValidationError('Message ID is required');
  }

  const message = await prisma.message.findUnique({
    where: {
      id: messageId,
    },
    include: {
      class: {
        select: {
          teacherId: true,
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  if (!message) {
    throw new NotFoundError('Message not found');
  }

  // Verify user is a member of the class
  const membership = await prisma.classMembership.findFirst({
    where: {
      classId: message.classId,
      userId: req.user!.id,
      isActive: true,
    },
  });

  if (!membership) {
    throw new AuthorizationError('You are not a member of this class');
  }

  // Only allow message author, class teacher, or admin to delete
  const isAuthor = message.senderId === req.user!.id;
  const isClassTeacher = message.class.teacherId === req.user!.id;
  const isAdmin = req.user!.role === 'ADMIN';

  if (!isAuthor && !isClassTeacher && !isAdmin) {
    throw new AuthorizationError('You can only delete your own messages');
  }

  // Check if message has replies (soft delete if it has replies)
  if (message._count.replies > 0) {
    // Soft delete - replace content with [deleted] but keep the message structure
    await prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        content: '[This message has been deleted]',
        updatedAt: new Date(),
      },
    });

    logger.info(`Message soft deleted (has replies): ${messageId}`, {
      messageId,
      deleterId: req.user!.id,
      authorId: message.senderId,
      classId: message.classId,
      replyCount: message._count.replies,
    });

    res.json({ 
      message: 'Message deleted successfully',
      type: 'soft_delete',
      reason: 'Message has replies'
    });
  } else {
    // Hard delete - completely remove the message
    await prisma.message.delete({
      where: {
        id: messageId,
      },
    });

    logger.info(`Message hard deleted: ${messageId}`, {
      messageId,
      deleterId: req.user!.id,
      authorId: message.senderId,
      classId: message.classId,
    });

    res.json({ 
      message: 'Message deleted successfully',
      type: 'hard_delete'
    });
  }
};

/**
 * Get message by ID (for direct access)
 * GET /api/messages/:messageId
 */
export const getMessageById = async (req: Request, res: Response): Promise<void> => {
  const { messageId } = req.params;

  if (!messageId) {
    throw new ValidationError('Message ID is required');
  }

  const message = await prisma.message.findUnique({
    where: {
      id: messageId,
    },
    include: {
      sender: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      attachments: {
        select: {
          id: true,
          filename: true,
          url: true,
          mimetype: true,
          size: true,
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  if (!message) {
    throw new NotFoundError('Message not found');
  }

  // Verify user is a member of the class
  const membership = await prisma.classMembership.findFirst({
    where: {
      classId: message.classId,
      userId: req.user!.id,
      isActive: true,
    },
  });

  if (!membership) {
    throw new AuthorizationError('You are not a member of this class');
  }

  logger.info(`Retrieved message: ${messageId}`, {
    userId: req.user!.id,
    messageId,
    classId: message.classId,
  });

  res.json(message);
}; 