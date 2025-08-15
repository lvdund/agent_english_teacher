import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';
import { config } from '@/config/environment';
import { getPrismaClient } from '@/config/database';
import { redisUtils, redisKeys } from '@/config/redis';
import { logger, loggers } from '@/utils/logger';
import { AuthenticationError } from '@/middleware/errorHandler';

// Token payload interface
export interface TokenPayload {
  userId: string;
  email: string;
  role: 'STUDENT' | 'TEACHER' | 'ADMIN';
  firstName: string;
  lastName: string;
  isActive: boolean;
  classIds?: string[];
}

// Token pair interface
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Decoded token interface
export interface DecodedToken extends TokenPayload {
  iat: number;
  exp: number;
  jti: string;
}

export class TokenService {
  private readonly prisma = getPrismaClient();

  /**
   * Generate access token
   */
  generateAccessToken(payload: TokenPayload): string {
    const jti = uuidv4(); // Unique token ID
    
    const tokenPayload = {
      ...payload,
      jti,
    };

    const jwtOptions: jwt.SignOptions = {
      expiresIn: config.jwt.expiresIn as StringValue | number,
      issuer: 'agent-english-teacher',
      audience: 'agent-english-teacher-users',
    };
    
    return jwt.sign(tokenPayload, config.jwt.secret, jwtOptions);
  }

  /**
   * Generate refresh token and store in database
   */
  async generateRefreshToken(
    userId: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<string> {
    const token = uuidv4();
    const expiresAt = new Date();
    
    // Calculate expiration date
    const expirationDays = parseInt(config.jwt.refreshExpiresIn.replace('d', ''));
    expiresAt.setDate(expiresAt.getDate() + expirationDays);

    try {
      // Store refresh token in database
      await this.prisma.refreshToken.create({
        data: {
          token,
          userId,
          expiresAt,
          userAgent: userAgent || null,
          ipAddress: ipAddress || null,
        },
      });

      // Cache in Redis for faster lookup
      await redisUtils.set(
        redisKeys.refreshToken(token),
        { userId, expiresAt: expiresAt.toISOString() },
        60 * 60 * 24 * expirationDays // TTL in seconds
      );

      loggers.auth.login(userId, 'unknown', ipAddress || 'unknown');
      return token;
    } catch (error) {
      logger.error('Failed to generate refresh token:', error);
      throw new Error('Failed to generate refresh token');
    }
  }

  /**
   * Generate token pair (access + refresh tokens)
   */
  async generateTokenPair(
    user: TokenPayload,
    userAgent?: string,
    ipAddress?: string
  ): Promise<TokenPair> {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user.userId, userAgent, ipAddress);
    
    // Calculate expiration time in seconds
    const expiresIn = this.getTokenExpirationTime(config.jwt.expiresIn);

    return {
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  /**
   * Verify and decode access token
   */
  verifyAccessToken(token: string): DecodedToken {
    try {
      const verifyOptions: jwt.VerifyOptions = {
        issuer: 'agent-english-teacher',
        audience: 'agent-english-teacher-users',
      };
      
      const decoded = jwt.verify(token, config.jwt.secret, verifyOptions) as DecodedToken;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid token');
      } else {
        throw new AuthenticationError('Token verification failed');
      }
    }
  }

  /**
   * Verify refresh token
   */
  async verifyRefreshToken(token: string): Promise<{ userId: string; isValid: boolean }> {
    try {
      // Check Redis cache first
      const cachedToken = await redisUtils.get(redisKeys.refreshToken(token));
      
      if (cachedToken) {
        const expiresAt = new Date(cachedToken.expiresAt);
        if (expiresAt > new Date()) {
          return { userId: cachedToken.userId, isValid: true };
        }
      }

      // Check database
      const refreshToken = await this.prisma.refreshToken.findUnique({
        where: { token },
        select: {
          userId: true,
          expiresAt: true,
          isRevoked: true,
        },
      });

      if (!refreshToken || refreshToken.isRevoked || refreshToken.expiresAt < new Date()) {
        return { userId: '', isValid: false };
      }

      return { userId: refreshToken.userId, isValid: true };
    } catch (error) {
      logger.error('Failed to verify refresh token:', error);
      return { userId: '', isValid: false };
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<string> {
    const { userId, isValid } = await this.verifyRefreshToken(refreshToken);
    
    if (!isValid) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    // Get user data
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          select: { classId: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new AuthenticationError('User not found or inactive');
    }

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

    return this.generateAccessToken(tokenPayload);
  }

  /**
   * Revoke refresh token
   */
  async revokeRefreshToken(token: string): Promise<void> {
    try {
      // Update database
      await this.prisma.refreshToken.updateMany({
        where: { token },
        data: { isRevoked: true },
      });

      // Remove from Redis cache
      await redisUtils.del(redisKeys.refreshToken(token));

      logger.info('Refresh token revoked:', { token: token.substring(0, 8) + '...' });
    } catch (error) {
      logger.error('Failed to revoke refresh token:', error);
      throw new Error('Failed to revoke refresh token');
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    try {
      // Get all user tokens
      const userTokens = await this.prisma.refreshToken.findMany({
        where: { userId, isRevoked: false },
        select: { token: true },
      });

      // Revoke in database
      await this.prisma.refreshToken.updateMany({
        where: { userId },
        data: { isRevoked: true },
      });

      // Remove from Redis cache
      for (const tokenRecord of userTokens) {
        await redisUtils.del(redisKeys.refreshToken(tokenRecord.token));
      }

      loggers.auth.logout(userId, 'unknown');
      logger.info('All refresh tokens revoked for user:', { userId });
    } catch (error) {
      logger.error('Failed to revoke all user tokens:', error);
      throw new Error('Failed to revoke user tokens');
    }
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens(): Promise<void> {
    try {
      const expiredTokens = await this.prisma.refreshToken.findMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { isRevoked: true },
          ],
        },
        select: { token: true },
      });

      // Delete from database
      await this.prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { isRevoked: true },
          ],
        },
      });

      // Remove from Redis cache
      for (const tokenRecord of expiredTokens) {
        await redisUtils.del(redisKeys.refreshToken(tokenRecord.token));
      }

      logger.info('Cleaned up expired tokens:', { count: expiredTokens.length });
    } catch (error) {
      logger.error('Failed to cleanup expired tokens:', error);
    }
  }

  /**
   * Get token expiration time in seconds
   */
  private getTokenExpirationTime(expiresIn: string): number {
    const unit = expiresIn.slice(-1);
    const value = parseInt(expiresIn.slice(0, -1));

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      default:
        return 60 * 60; // Default to 1 hour
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }

  /**
   * Get user info from token
   */
  async getUserFromToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = this.verifyAccessToken(token);
      
      // Verify user still exists and is active
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: {
          memberships: {
            select: { classId: true },
          },
        },
      });

      if (!user || !user.isActive) {
        return null;
      }

      return {
        userId: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        classIds: user.memberships.map(m => m.classId),
      };
    } catch (error) {
      return null;
    }
  }
}

// Export singleton instance
export const tokenService = new TokenService(); 