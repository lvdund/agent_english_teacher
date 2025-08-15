import { Router } from 'express';
import { authController } from '@/controllers/authController';
import { authenticate } from '@/middleware/authenticate';
import { anyRole } from '@/middleware/authorize';
import { authRateLimiter } from '@/middleware/rateLimiter';

const router = Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 * @body    { email, password, firstName, lastName, role, classCode? }
 */
router.post('/register', authRateLimiter, authController.register);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 * @body    { email, password }
 */
router.post('/login', authRateLimiter, authController.login);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (revoke refresh token)
 * @access  Public
 * @body    { refreshToken }
 */
router.post('/logout', authController.logout);

/**
 * @route   POST /api/auth/logout-all
 * @desc    Logout from all devices
 * @access  Private
 */
router.post('/logout-all', authenticate, anyRole, authController.logoutAll);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 * @body    { refreshToken }
 */
router.post('/refresh', authController.refreshToken);

/**
 * @route   PUT /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 * @body    { currentPassword, newPassword }
 */
router.put('/change-password', authenticate, anyRole, authController.changePassword);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 * @body    { email }
 */
router.post('/forgot-password', authRateLimiter, authController.forgotPassword);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', authenticate, anyRole, authController.getCurrentUser);

/**
 * @route   GET /api/auth/validate
 * @desc    Validate token
 * @access  Public
 * @headers Authorization: Bearer <token>
 */
router.get('/validate', authController.validateToken);

export default router; 