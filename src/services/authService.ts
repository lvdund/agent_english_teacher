import bcrypt from 'bcryptjs';
import { getPrismaClient } from '@/config/database';
import { redisUtils, redisKeys } from '@/config/redis';
import { config } from '@/config/environment';
import { logger, loggers } from '@/utils/logger';
import { tokenService, TokenPayload, TokenPair } from './tokenService';
import {
  AuthenticationError,
  ValidationError,
  ConflictError,
  NotFoundError,
} from '@/middleware/errorHandler';

// Registration request interface
export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'STUDENT' | 'TEACHER';
  classCode?: string; // For students joining a class
}

// Login request interface
export interface LoginRequest {
  email: string;
  password: string;
}

// Password reset request interface
export interface PasswordResetRequest {
  email: string;
}

// Change password request interface
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export class AuthService {
  private readonly prisma = getPrismaClient();

  /**
   * Register a new user
   */
  async register(
    request: RegisterRequest,
    userAgent?: string,
    ipAddress?: string
  ): Promise<{ user: TokenPayload; tokens: TokenPair }> {
    // Validate email format
    if (!this.isValidEmail(request.email)) {
      throw new ValidationError('Invalid email format');
    }

    // Validate password strength
    if (!this.isValidPassword(request.password)) {
      throw new ValidationError(
        'Password must be at least 8 characters long and contain uppercase, lowercase, number, and special character'
      );
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: request.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    // Validate class code if provided
    let targetClass = null;
    if (request.classCode) {
      targetClass = await this.prisma.class.findUnique({
        where: { code: request.classCode },
      });

      if (!targetClass) {
        throw new ValidationError('Invalid class code');
      }

      if (targetClass.status !== 'ACTIVE') {
        throw new ValidationError('Class is not active');
      }
    }

    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(request.password, config.security.bcryptRounds);

      // Create user and class membership in transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // Create user
        const user = await tx.user.create({
          data: {
            email: request.email.toLowerCase(),
            password: hashedPassword,
            firstName: request.firstName,
            lastName: request.lastName,
            role: request.role,
            preferences: {
              language: 'en',
              timezone: 'UTC',
              notifications: {
                email: true,
                push: true,
                newMessages: true,
                classUpdates: true,
              },
              aiSettings: {
                model: 'gpt-4',
                maxTokens: request.role === 'TEACHER' ? 1500 : 800,
                temperature: 0.7,
              },
            },
          },
        });

        // Join class if code provided
        if (targetClass) {
          await tx.classMembership.create({
            data: {
              userId: user.id,
              classId: targetClass.id,
              role: request.role,
              permissions: {
                canSendMessages: true,
                canUploadFiles: true,
                canUseAI: true,
                ...(request.role === 'TEACHER' && {
                  canManageStudents: true,
                  canViewAllChats: true,
                  canModerateContent: true,
                  canAccessAnalytics: true,
                }),
              },
            },
          });
        }

        return user;
      });

      // Create token payload
      const tokenPayload: TokenPayload = {
        userId: result.id,
        email: result.email,
        role: result.role,
        firstName: result.firstName,
        lastName: result.lastName,
        isActive: result.isActive,
        classIds: targetClass ? [targetClass.id] : [],
      };

      // Generate tokens
      const tokens = await tokenService.generateTokenPair(tokenPayload, userAgent, ipAddress);

      // Log successful registration
      logger.info('User registered successfully:', {
        userId: result.id,
        email: result.email,
        role: result.role,
        classJoined: !!targetClass,
      });

      return {
        user: tokenPayload,
        tokens,
      };
    } catch (error) {
      logger.error('Registration failed:', error);
      throw new Error('Registration failed');
    }
  }

  /**
   * Login user
   */
  async login(
    request: LoginRequest,
    userAgent?: string,
    ipAddress?: string
  ): Promise<{ user: TokenPayload; tokens: TokenPair }> {
    const clientIp = ipAddress || 'unknown';

    // Check for too many login attempts
    await this.checkLoginAttempts(clientIp);

    try {
      // Find user by email
      const user = await this.prisma.user.findUnique({
        where: { email: request.email.toLowerCase() },
        include: {
          memberships: {
            select: { classId: true },
          },
        },
      });

      if (!user) {
        await this.recordFailedLogin(clientIp, request.email, 'User not found');
        throw new AuthenticationError('Invalid email or password');
      }

      if (!user.isActive) {
        await this.recordFailedLogin(clientIp, request.email, 'Account inactive');
        throw new AuthenticationError('Account is inactive');
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(request.password, user.password);
      if (!isValidPassword) {
        await this.recordFailedLogin(clientIp, request.email, 'Invalid password');
        throw new AuthenticationError('Invalid email or password');
      }

      // Clear failed login attempts
      await this.clearLoginAttempts(clientIp);

      // Create token payload
      const tokenPayload: TokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        classIds: user.memberships.map(m => m.classId),
      };

      // Generate tokens
      const tokens = await tokenService.generateTokenPair(tokenPayload, userAgent, ipAddress);

      // Log successful login
      loggers.auth.login(user.id, user.email, clientIp);

      return {
        user: tokenPayload,
        tokens,
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      logger.error('Login failed:', error);
      throw new AuthenticationError('Login failed');
    }
  }

  /**
   * Logout user
   */
  async logout(refreshToken: string, userId?: string): Promise<void> {
    try {
      await tokenService.revokeRefreshToken(refreshToken);
      
      if (userId) {
        loggers.auth.logout(userId, 'unknown');
      }
    } catch (error) {
      logger.error('Logout failed:', error);
      throw new Error('Logout failed');
    }
  }

  /**
   * Logout from all devices
   */
  async logoutAll(userId: string): Promise<void> {
    try {
      await tokenService.revokeAllUserTokens(userId);
    } catch (error) {
      logger.error('Logout all failed:', error);
      throw new Error('Logout failed');
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<string> {
    try {
      return await tokenService.refreshAccessToken(refreshToken);
    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw new AuthenticationError('Token refresh failed');
    }
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    request: ChangePasswordRequest
  ): Promise<void> {
    // Get user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(request.currentPassword, user.password);
    if (!isValidPassword) {
      throw new AuthenticationError('Current password is incorrect');
    }

    // Validate new password
    if (!this.isValidPassword(request.newPassword)) {
      throw new ValidationError(
        'New password must be at least 8 characters long and contain uppercase, lowercase, number, and special character'
      );
    }

    // Check if new password is different from current
    const isSamePassword = await bcrypt.compare(request.newPassword, user.password);
    if (isSamePassword) {
      throw new ValidationError('New password must be different from current password');
    }

    try {
      // Hash new password
      const hashedPassword = await bcrypt.hash(request.newPassword, config.security.bcryptRounds);

      // Update password and revoke all tokens
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { password: hashedPassword },
        });

        // Revoke all refresh tokens to force re-login
        await tx.refreshToken.updateMany({
          where: { userId },
          data: { isRevoked: true },
        });
      });

      // Clear Redis cache for user tokens
      await tokenService.revokeAllUserTokens(userId);

      logger.info('Password changed successfully:', { userId });
    } catch (error) {
      logger.error('Password change failed:', error);
      throw new Error('Password change failed');
    }
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(request: PasswordResetRequest): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: request.email.toLowerCase() },
    });

    if (!user) {
      // Don't reveal if email exists or not
      logger.warn('Password reset requested for non-existent email:', { email: request.email });
      return;
    }

    if (!user.isActive) {
      logger.warn('Password reset requested for inactive user:', { userId: user.id });
      return;
    }

    // TODO: Generate reset token and send email
    // For now, just log the request
    logger.info('Password reset requested:', { userId: user.id, email: user.email });
  }

  /**
   * Check login attempts for rate limiting
   */
  private async checkLoginAttempts(ipAddress: string): Promise<void> {
    const key = redisKeys.loginAttempts(ipAddress);
    const attempts = await redisUtils.get(key);
    
    if (attempts && attempts >= 5) {
      const ttl = await redisUtils.ttl(key);
      throw new AuthenticationError(
        `Too many login attempts. Try again in ${Math.ceil(ttl / 60)} minutes.`
      );
    }
  }

  /**
   * Record failed login attempt
   */
  private async recordFailedLogin(ipAddress: string, email: string, reason: string): Promise<void> {
    const key = redisKeys.loginAttempts(ipAddress);
    const attempts = await redisUtils.incr(key);
    
    if (attempts === 1) {
      // Set expiration for 15 minutes
      await redisUtils.expire(key, 15 * 60);
    }

    loggers.auth.loginFailed(email, ipAddress, reason);
  }

  /**
   * Clear login attempts after successful login
   */
  private async clearLoginAttempts(ipAddress: string): Promise<void> {
    const key = redisKeys.loginAttempts(ipAddress);
    await redisUtils.del(key);
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate password strength
   */
  private isValidPassword(password: string): boolean {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  }
}

// Export singleton instance
export const authService = new AuthService(); 