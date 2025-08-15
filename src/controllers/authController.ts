import { Request, Response, NextFunction } from 'express';
import { authService, RegisterRequest, LoginRequest, ChangePasswordRequest } from '@/services/authService';
import { tokenService } from '@/services/tokenService';
import { asyncHandler } from '@/middleware/errorHandler';
import { ApiResponse } from '@/types/api';
import { logger } from '@/utils/logger';

export class AuthController {
  /**
   * Register a new user
   * POST /api/auth/register
   */
  register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const registerData: RegisterRequest = {
      email: req.body.email,
      password: req.body.password,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      role: req.body.role,
      classCode: req.body.classCode,
    };

    const userAgent = req.get('User-Agent');
    const ipAddress = req.ip;

    const result = await authService.register(registerData, userAgent, ipAddress);

    const response: ApiResponse = {
      status: 'success',
      message: 'User registered successfully',
      data: {
        user: {
          id: result.user.userId,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
          isActive: result.user.isActive,
          classIds: result.user.classIds,
        },
        tokens: {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
        },
      },
    };

    res.status(201).json(response);
  });

  /**
   * Login user
   * POST /api/auth/login
   */
  login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const loginData: LoginRequest = {
      email: req.body.email,
      password: req.body.password,
    };

    const userAgent = req.get('User-Agent');
    const ipAddress = req.ip;

    const result = await authService.login(loginData, userAgent, ipAddress);

    const response: ApiResponse = {
      status: 'success',
      message: 'Login successful',
      data: {
        user: {
          id: result.user.userId,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
          isActive: result.user.isActive,
          classIds: result.user.classIds,
        },
        tokens: {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          expiresIn: result.tokens.expiresIn,
        },
      },
    };

    res.status(200).json(response);
  });

  /**
   * Logout user (revoke refresh token)
   * POST /api/auth/logout
   */
  logout = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const refreshToken = req.body.refreshToken;

    if (!refreshToken) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Refresh token required',
      };
      res.status(400).json(response);
      return;
    }

    await authService.logout(refreshToken, req.user?.id);

    const response: ApiResponse = {
      status: 'success',
      message: 'Logout successful',
    };

    res.status(200).json(response);
  });

  /**
   * Logout from all devices
   * POST /api/auth/logout-all
   */
  logoutAll = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Authentication required',
      };
      res.status(401).json(response);
      return;
    }

    await authService.logoutAll(req.user.id);

    const response: ApiResponse = {
      status: 'success',
      message: 'Logged out from all devices',
    };

    res.status(200).json(response);
  });

  /**
   * Refresh access token
   * POST /api/auth/refresh
   */
  refreshToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const refreshToken = req.body.refreshToken;

    if (!refreshToken) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Refresh token required',
      };
      res.status(400).json(response);
      return;
    }

    const newAccessToken = await authService.refreshToken(refreshToken);

    const response: ApiResponse = {
      status: 'success',
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
      },
    };

    res.status(200).json(response);
  });

  /**
   * Change password
   * PUT /api/auth/change-password
   */
  changePassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Authentication required',
      };
      res.status(401).json(response);
      return;
    }

    const changePasswordData: ChangePasswordRequest = {
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    };

    await authService.changePassword(req.user.id, changePasswordData);

    const response: ApiResponse = {
      status: 'success',
      message: 'Password changed successfully. Please login again.',
    };

    res.status(200).json(response);
  });

  /**
   * Request password reset
   * POST /api/auth/forgot-password
   */
  forgotPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const email = req.body.email;

    if (!email) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Email is required',
      };
      res.status(400).json(response);
      return;
    }

    await authService.requestPasswordReset({ email });

    // Always return success to prevent email enumeration
    const response: ApiResponse = {
      status: 'success',
      message: 'If the email exists, a password reset link has been sent',
    };

    res.status(200).json(response);
  });

  /**
   * Get current user profile
   * GET /api/auth/me
   */
  getCurrentUser = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Authentication required',
      };
      res.status(401).json(response);
      return;
    }

    const response: ApiResponse = {
      status: 'success',
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          role: req.user.role,
          isActive: req.user.isActive,
          classIds: req.user.classIds,
        },
      },
    };

    res.status(200).json(response);
  });

  /**
   * Validate token
   * GET /api/auth/validate
   */
  validateToken = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const authHeader = req.headers.authorization;
    const token = tokenService.extractTokenFromHeader(authHeader);

    if (!token) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Token required',
      };
      res.status(400).json(response);
      return;
    }

    try {
      const user = await tokenService.getUserFromToken(token);
      
      if (!user) {
        const response: ApiResponse = {
          status: 'error',
          message: 'Invalid token',
        };
        res.status(401).json(response);
        return;
      }

      const response: ApiResponse = {
        status: 'success',
        message: 'Token is valid',
        data: {
          user: {
            id: user.userId,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            isActive: user.isActive,
            classIds: user.classIds,
          },
        },
      };

      res.status(200).json(response);
    } catch (error) {
      const response: ApiResponse = {
        status: 'error',
        message: 'Invalid token',
      };
      res.status(401).json(response);
    }
  });
}

// Export singleton instance
export const authController = new AuthController(); 