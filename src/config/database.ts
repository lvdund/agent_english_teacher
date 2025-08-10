import { PrismaClient } from '@prisma/client';
import { config } from '@/config/environment';
import { logger } from '@/utils/logger';

// Prisma client instance
let prismaClient: PrismaClient | null = null;

// Prisma client configuration
const getPrismaConfig = () => {
  if (config.isDevelopment) {
    return {
      log: ['query', 'info', 'warn', 'error'] as ('query' | 'info' | 'warn' | 'error')[],
      datasources: {
        db: {
          url: config.database.url,
        },
      },
    };
  } else {
    return {
      log: ['warn', 'error'] as ('warn' | 'error')[],
      datasources: {
        db: {
          url: config.database.url,
        },
      },
    };
  }
};

// Create Prisma client
export const createPrismaClient = (): PrismaClient => {
  if (prismaClient) {
    return prismaClient;
  }

  try {
    prismaClient = new PrismaClient(getPrismaConfig());

    // Connection event handlers (only if logging is enabled)
    if (config.isDevelopment) {
      (prismaClient as any).$on('query', (e: any) => {
        logger.debug('Database Query:', {
          query: e.query,
          params: e.params,
          duration: `${e.duration}ms`,
        });
      });

      (prismaClient as any).$on('info', (e: any) => {
        logger.info('Database Info:', e.message);
      });
    }

    (prismaClient as any).$on('warn', (e: any) => {
      logger.warn('Database Warning:', e.message);
    });

    (prismaClient as any).$on('error', (e: any) => {
      logger.error('Database Error:', e.message);
    });

    return prismaClient;
  } catch (error) {
    logger.error('Failed to create Prisma client:', error);
    throw error;
  }
};

// Get Prisma client instance
export const getPrismaClient = (): PrismaClient => {
  if (!prismaClient) {
    return createPrismaClient();
  }
  return prismaClient;
};

// Connect to database
export const connectDatabase = async (): Promise<void> => {
  try {
    const client = getPrismaClient();
    await client.$connect();
    logger.info('✅ Database connected successfully');
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
    throw error;
  }
};

// Disconnect from database
export const disconnectDatabase = async (): Promise<void> => {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
    logger.info('🔌 Database disconnected');
  }
};

// Test database connection
export const testDatabaseConnection = async (): Promise<boolean> => {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    logger.info('✅ Database ping successful');
    return true;
  } catch (error) {
    logger.error('❌ Database ping failed:', error);
    return false;
  }
};

// Database health check
export const getDatabaseHealth = async (): Promise<{
  connected: boolean;
  version?: string;
  stats?: any;
}> => {
  try {
    const client = getPrismaClient();
    
    // Test basic connectivity
    await client.$queryRaw`SELECT 1`;
    
    // Get PostgreSQL version
    const versionResult = await client.$queryRaw<{ version: string }[]>`SELECT version()`;
    const version = versionResult[0]?.version;
    
    // Get basic database stats
    const statsResult = await client.$queryRaw<any[]>`
      SELECT 
        schemaname,
        relname AS tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes
      FROM pg_stat_user_tables
      ORDER BY schemaname, tablename
    `;

    const result: { connected: boolean; version?: string; stats?: any } = {
      connected: true,
      stats: statsResult,
    };
    
    if (version) {
      result.version = version;
    }
    
    return result;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return {
      connected: false,
    };
  }
};

// Database utility functions
export const dbUtils = {
  // Execute raw SQL safely
  async executeRaw(sql: string, params?: any[]): Promise<any> {
    const client = getPrismaClient();
    return await client.$queryRawUnsafe(sql, ...(params || []));
  },

  // Transaction wrapper
  async transaction<T>(
    operations: (tx: any) => Promise<T>
  ): Promise<T> {
    const client = getPrismaClient();
    return await client.$transaction(operations);
  },

  // Batch operations
  async batchExecute(operations: any[]): Promise<any[]> {
    const client = getPrismaClient();
    return await client.$transaction(operations);
  },

  // Reset database (development only)
  async resetDatabase(): Promise<void> {
    if (config.isProduction) {
      throw new Error('Cannot reset database in production');
    }

    const client = getPrismaClient();
    
    logger.warn('🗑️ Resetting database...');
    
    // Get all table names
    const tables = await client.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public'
    `;

    // Drop all tables
    for (const table of tables) {
      await client.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table.tablename}" CASCADE`);
    }

    logger.info('✅ Database reset complete');
  },

  // Get database size
  async getDatabaseSize(): Promise<{
    size: string;
    sizeBytes: number;
  }> {
    const client = getPrismaClient();
    const result = await client.$queryRaw<{
      size: string;
      size_bytes: number;
    }[]>`
      SELECT 
        pg_size_pretty(pg_database_size(current_database())) as size,
        pg_database_size(current_database()) as size_bytes
    `;

    return {
      size: result[0]?.size || '0 bytes',
      sizeBytes: result[0]?.size_bytes || 0,
    };
  },

  // Get table statistics
  async getTableStats(): Promise<any[]> {
    const client = getPrismaClient();
    return await client.$queryRaw`
      SELECT 
        schemaname,
        relname AS tablename,
        n_tup_ins as total_inserts,
        n_tup_upd as total_updates,
        n_tup_del as total_deletes,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_stat_user_tables 
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;
  },
};

// Export the Prisma client type for use in other files
export type { PrismaClient } from '@prisma/client';

// Export default Prisma client instance
export default prismaClient; 