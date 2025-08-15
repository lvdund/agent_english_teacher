import { Router } from 'express';
import { authenticate } from '@/middleware/authenticate';
import { anyRole } from '@/middleware/authorize';
import {
  getClassMessages,
  createMessage,
  getMessageThread,
  updateMessage,
  deleteMessage,
  getMessageById,
} from '@/controllers/messageController';

const router = Router();

// All message routes require authentication
router.use(authenticate);

// Class-based message routes (nested under classes)
// These will be mounted at /api/classes/:classId/messages by the classes router

// Message-specific routes (direct access)
// These will be mounted at /api/messages

/**
 * @route   GET /api/messages/:messageId
 * @desc    Get a specific message by ID
 * @access  Private (Class members only)
 */
router.get('/:messageId', anyRole, getMessageById);

/**
 * @route   GET /api/messages/:messageId/thread
 * @desc    Get a message with its full thread (replies)
 * @access  Private (Class members only)
 */
router.get('/:messageId/thread', anyRole, getMessageThread);

/**
 * @route   PUT /api/messages/:messageId
 * @desc    Update a message (author, class teacher, or admin only)
 * @access  Private (Author, Class teacher, or Admin)
 */
router.put('/:messageId', anyRole, updateMessage);

/**
 * @route   DELETE /api/messages/:messageId
 * @desc    Delete a message (author, class teacher, or admin only)
 * @access  Private (Author, Class teacher, or Admin)
 */
router.delete('/:messageId', anyRole, deleteMessage);

export default router;

// Export individual route handlers for mounting in class routes
export {
  getClassMessages,
  createMessage,
}; 