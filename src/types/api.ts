// Base API response structure
export interface ApiResponse<T = any> {
  status: 'success' | 'error';
  message?: string;
  data?: T;
  errors?: string[];
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// Pagination parameters
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Search parameters
export interface SearchQuery extends PaginationQuery {
  search?: string;
  filter?: Record<string, any>;
}

// User roles
export enum UserRole {
  STUDENT = 'STUDENT',
  TEACHER = 'TEACHER',
  ADMIN = 'ADMIN',
}

// Message types
export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  FILE = 'FILE',
  SYSTEM = 'SYSTEM',
  AI_RESPONSE = 'AI_RESPONSE',
}

// Class status
export enum ClassStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
}

// File types
export interface FileUpload {
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  path: string;
  url: string;
}

// Authentication related types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  classCode?: string; // For students joining a class
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  avatar?: string;
  bio?: string;
  preferences?: UserPreferences;
}

export interface UserPreferences {
  language: string;
  timezone: string;
  notifications: {
    email: boolean;
    push: boolean;
    newMessages: boolean;
    classUpdates: boolean;
  };
  aiSettings: {
    model: string;
    maxTokens: number;
    temperature: number;
  };
}

// Class related types
export interface ClassInfo {
  id: string;
  name: string;
  description?: string;
  code: string; // Unique join code
  status: ClassStatus;
  teacherId: string;
  teacher: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  studentsCount: number;
  messagesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClassMembership {
  id: string;
  userId: string;
  classId: string;
  role: 'TEACHER' | 'STUDENT';
  joinedAt: Date;
  isActive: boolean;
}

// Message related types
export interface MessageContent {
  id: string;
  content: string;
  type: MessageType;
  senderId: string;
  classId: string;
  parentMessageId?: string; // For threading/replies
  attachments?: FileUpload[];
  aiMetadata?: {
    model: string;
    tokens: number;
    confidence: number;
    corrections?: string[];
    suggestions?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageThread {
  parentMessage: MessageContent;
  replies: MessageContent[];
  totalReplies: number;
}

// AI related types
export interface AIRequest {
  message: string;
  context?: string;
  userId: string;
  classId: string;
  type: 'GRAMMAR_CHECK' | 'VOCABULARY_HELP' | 'GENERAL_HELP' | 'EXAM_MARKING';
  attachments?: FileUpload[];
}

export interface AIResponse {
  response: string;
  corrections?: {
    original: string;
    corrected: string;
    explanation: string;
    type: 'grammar' | 'spelling' | 'vocabulary' | 'style';
  }[];
  suggestions?: string[];
  confidence: number;
  model: string;
  tokens: number;
  processingTime: number;
}

// Exam marking types
export interface ExamSubmission {
  id: string;
  studentId: string;
  classId: string;
  title: string;
  type: 'IELTS_WRITING' | 'IELTS_SPEAKING' | 'TOEIC' | 'GENERAL_ESSAY';
  content: string;
  attachments?: FileUpload[];
  submittedAt: Date;
  gradedAt?: Date;
  grade?: ExamGrade;
}

export interface ExamGrade {
  overall: number;
  breakdown: {
    criterion: string;
    score: number;
    feedback: string;
  }[];
  feedback: string;
  improvements: string[];
  strengths: string[];
}

// Analytics types
export interface ClassAnalytics {
  classId: string;
  period: 'day' | 'week' | 'month';
  metrics: {
    totalMessages: number;
    aiInteractions: number;
    activeStudents: number;
    avgResponseTime: number;
    commonTopics: string[];
    errorTypes: {
      type: string;
      count: number;
    }[];
  };
}

// WebSocket event types
export interface SocketEvents {
  // Client to server
  'join:class': { classId: string };
  'leave:class': { classId: string };
  'message:send': { classId: string; content: string; type: MessageType };
  'message:typing': { classId: string; isTyping: boolean };
  
  // Server to client
  'message:new': MessageContent;
  'message:updated': MessageContent;
  'user:typing': { userId: string; isTyping: boolean };
  'class:updated': ClassInfo;
  'notification': { type: string; message: string; data?: any };
}

// Error types
export interface APIError {
  code: string;
  message: string;
  field?: string;
  details?: any;
}

export interface ValidationErrors {
  [field: string]: string[];
} 