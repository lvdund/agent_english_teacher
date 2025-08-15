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

// Make this file a module to enable global declarations
export {}; 