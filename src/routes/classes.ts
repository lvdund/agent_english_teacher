import { Router } from 'express';
import { classController } from '@/controllers/classController';
import { authenticate } from '@/middleware/authenticate';
import { anyRole, teacherOrAdmin, authorizeClassTeacher, classIdFromParams } from '@/middleware/authorize';
import { getClassMessages, createMessage } from '@/controllers/messageController';

const router = Router();

/**
 * @route   POST /api/classes
 * @desc    Create a new class
 * @access  Private (Teachers and Admins only)
 */
router.post('/', authenticate, teacherOrAdmin, classController.createClass);

/**
 * @route   GET /api/classes
 * @desc    Get all classes (filtered by user permissions)
 * @access  Private (Any authenticated user)
 */
router.get('/', authenticate, anyRole, classController.getClasses);

/**
 * @route   POST /api/classes/join
 * @desc    Join a class using class code
 * @access  Private (Any authenticated user)
 */
router.post('/join', authenticate, anyRole, classController.joinClass);

/**
 * @route   GET /api/classes/:id
 * @desc    Get class details by ID
 * @access  Private (Class members only)
 */
router.get('/:id', authenticate, anyRole, classController.getClassById);

/**
 * @route   PUT /api/classes/:id
 * @desc    Update class details
 * @access  Private (Class teachers only)
 */
router.put('/:id', authenticate, teacherOrAdmin, classController.updateClass);

/**
 * @route   GET /api/classes/:id/analytics
 * @desc    Get class analytics
 * @access  Private (Class teachers only)
 */
router.get('/:id/analytics', authenticate, teacherOrAdmin, classController.getClassAnalytics);

/**
 * @route   DELETE /api/classes/:id/members/:userId
 * @desc    Remove member from class
 * @access  Private (Class teachers only)
 */
router.delete('/:id/members/:userId', authenticate, teacherOrAdmin, classController.removeMember);

/**
 * @route   GET /api/classes/:classId/messages
 * @desc    Get messages for a specific class
 * @access  Private (Class members only)
 */
router.get('/:classId/messages', authenticate, anyRole, getClassMessages);

/**
 * @route   POST /api/classes/:classId/messages
 * @desc    Create a new message in a class
 * @access  Private (Class members only)
 */
router.post('/:classId/messages', authenticate, anyRole, createMessage);

export default router; 