import { User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'STUDENT' | 'TEACHER' | 'ADMIN';
        firstName: string;
        lastName: string;
        isActive: boolean;
        classIds?: string[];
      };
      file?: Express.Multer.File;
      files?: Express.Multer.File[];
    }
  }
}

export {}; 