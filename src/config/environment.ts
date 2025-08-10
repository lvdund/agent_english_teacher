import { z } from 'zod';

// Environment variables validation schema
const envSchema = z.object({
  // Server Configuration
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  HOST: z.string().default('localhost'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // JWT Authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Redis Configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().transform(Number).default('0'),

  // File Upload Configuration
  MAX_FILE_SIZE: z.string().transform(Number).default('10485760'), // 10MB
  UPLOAD_DIR: z.string().default('uploads'),
  ALLOWED_FILE_TYPES: z.string().default('jpg,jpeg,png,gif,pdf,doc,docx,txt'),

  // AI Integration
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gpt-4'),
  AI_MAX_TOKENS: z.string().transform(Number).default('1000'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),
  RATE_LIMIT_STUDENT_MAX: z.string().transform(Number).default('50'),
  RATE_LIMIT_TEACHER_MAX: z.string().transform(Number).default('200'),

  // CORS Configuration
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  CORS_CREDENTIALS: z.string().transform(value => value === 'true').default('true'),

  // Security
  BCRYPT_ROUNDS: z.string().transform(Number).default('12'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE: z.string().default('logs/app.log'),

  // Email Configuration
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Monitoring
  ENABLE_METRICS: z.string().transform(value => value === 'true').default('false'),
  METRICS_PORT: z.string().transform(Number).default('9090'),
});

// Validate environment variables
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment variables:', parseResult.error.format());
  process.exit(1);
}

export const config = {
  // Server
  nodeEnv: parseResult.data.NODE_ENV,
  port: parseResult.data.PORT,
  host: parseResult.data.HOST,
  isDevelopment: parseResult.data.NODE_ENV === 'development',
  isProduction: parseResult.data.NODE_ENV === 'production',
  isTest: parseResult.data.NODE_ENV === 'test',

  // Database
  database: {
    url: parseResult.data.DATABASE_URL,
  },

  // JWT
  jwt: {
    secret: parseResult.data.JWT_SECRET,
    expiresIn: parseResult.data.JWT_EXPIRES_IN,
    refreshSecret: parseResult.data.JWT_REFRESH_SECRET,
    refreshExpiresIn: parseResult.data.JWT_REFRESH_EXPIRES_IN,
  },

  // Redis
  redis: {
    url: parseResult.data.REDIS_URL,
    password: parseResult.data.REDIS_PASSWORD,
    db: parseResult.data.REDIS_DB,
  },

  // File Upload
  upload: {
    maxFileSize: parseResult.data.MAX_FILE_SIZE,
    uploadDir: parseResult.data.UPLOAD_DIR,
    allowedFileTypes: parseResult.data.ALLOWED_FILE_TYPES.split(','),
  },

  // AI
  ai: {
    openaiApiKey: parseResult.data.OPENAI_API_KEY,
    anthropicApiKey: parseResult.data.ANTHROPIC_API_KEY,
    model: parseResult.data.AI_MODEL,
    maxTokens: parseResult.data.AI_MAX_TOKENS,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseResult.data.RATE_LIMIT_WINDOW_MS,
    maxRequests: parseResult.data.RATE_LIMIT_MAX_REQUESTS,
    studentMax: parseResult.data.RATE_LIMIT_STUDENT_MAX,
    teacherMax: parseResult.data.RATE_LIMIT_TEACHER_MAX,
  },

  // CORS
  cors: {
    origin: parseResult.data.CORS_ORIGIN,
    credentials: parseResult.data.CORS_CREDENTIALS,
  },

  // Security
  security: {
    bcryptRounds: parseResult.data.BCRYPT_ROUNDS,
    sessionSecret: parseResult.data.SESSION_SECRET,
  },

  // Logging
  logging: {
    level: parseResult.data.LOG_LEVEL,
    file: parseResult.data.LOG_FILE,
  },

  // Email
  email: {
    host: parseResult.data.SMTP_HOST,
    port: parseResult.data.SMTP_PORT,
    user: parseResult.data.SMTP_USER,
    pass: parseResult.data.SMTP_PASS,
  },

  // Monitoring
  monitoring: {
    enabled: parseResult.data.ENABLE_METRICS,
    port: parseResult.data.METRICS_PORT,
  },
} as const;

export type Config = typeof config; 