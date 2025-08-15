import { Router } from 'express';
import { userController } from '@/controllers/userController';
import { authenticate } from '@/middleware/authenticate';
import { anyRole, adminOnly, teacherOrAdmin } from '@/middleware/authorize';

const router = Router();

/**
 * @route   GET /api/users/profile
 * @desc    Get current user profile
 * @access  Private (Any authenticated user)
 */
router.get('/profile', authenticate, anyRole, userController.getProfile);

/**
 * @route   PUT /api/users/profile
 * @desc    Update current user profile
 * @access  Private (Any authenticated user)
 */
router.put('/profile', authenticate, anyRole, userController.updateProfile);

/**
 * @route   GET /api/users/classes
 * @desc    Get user's classes
 * @access  Private (Any authenticated user)
 */
router.get('/classes', authenticate, anyRole, userController.getUserClasses);

/**
 * @route   GET /api/users/search
 * @desc    Search users
 * @access  Private (Teachers and Admins only)
 */
router.get('/search', authenticate, teacherOrAdmin, userController.searchUsers);

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Private (Own profile or Teachers/Admins)
 */
router.get('/:id', authenticate, anyRole, userController.getUserById);

/**
 * @route   PATCH /api/users/:id/status
 * @desc    Update user status (activate/deactivate)
 * @access  Private (Admins only)
 */
router.patch('/:id/status', authenticate, adminOnly, userController.updateUserStatus);

export default router; 