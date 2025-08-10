# Agent English Teacher - Backend

A backend API for an English learning platform where students chat with AI assistants and teachers can monitor conversations in real-time.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Git

### 1. Clone & Install
```bash
git clone https://github.com/lvdund/agent_english_teacher.git
cd agent-english-teacher
npm install
```

### 2. Environment Setup
```bash
# Copy environment template
cp example.env .env

# Edit .env with your settings (or use defaults for development)
nano .env
```

**Minimum required settings:**
```bash
# Database
DATABASE_URL="postgresql://postgres:password123@localhost:5432/agent_english_teacher"

# JWT Secrets (generate secure keys)
JWT_SECRET=your-super-secret-jwt-key-must-be-at-least-32-characters-long
JWT_REFRESH_SECRET=your-refresh-token-secret-must-be-at-least-32-characters-long
SESSION_SECRET=your-session-secret-key-must-be-at-least-32-characters-long

# Redis (optional password)
REDIS_PASSWORD=
```

### 3. Start Services
```bash
# Start PostgreSQL and Redis
docker-compose up -d

# Generate Prisma client
npm run db:generate

# Create database tables
npm run db:migrate
# (When prompted, name it "init")

# Seed with sample data
npm run db:seed
```

### 4. Start Development Server
```bash
npm run dev
```

Server starts at: `http://localhost:3001`

## 🧪 Test Your Setup

```bash
# Check health status
curl http://localhost:3001/health

# Should return JSON with database and Redis status
```

## 📊 Sample Data

After seeding, you can use these test accounts:

**Password for all accounts:** `123456`

- **Admin:** admin@englishteacher.com
- **Teacher:** sarah.teacher@englishteacher.com
- **Student:** alice.student@example.com

## 🔧 Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm start            # Start production server

npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run database migrations
npm run db:seed      # Populate with sample data
npm run db:studio    # Open database browser
npm run db:reset     # Reset and reseed database

npm test             # Run tests
npm run lint         # Check code quality
```

## 🏗️ Project Structure

```
src/
├── config/          # Configuration (database, redis, env)
├── middleware/      # Express middleware (auth, errors, rate limiting)
├── types/           # TypeScript type definitions
├── utils/           # Utility functions (logging)
└── server.ts        # Main server file

prisma/
├── schema.prisma    # Database schema
└── seed.ts          # Sample data
```

## 📋 Features (Backend)

- **Multi-tenant Classes:** Students and teachers organized in classes
- **Real-time Chat:** WebSocket support for live messaging
- **AI Integration:** Ready for OpenAI/Anthropic API integration
- **File Uploads:** Support for images, documents, audio files
- **Role-based Access:** Student, Teacher, Admin permissions
- **Comprehensive Logging:** Structured logs with Winston
- **Health Monitoring:** Database and Redis status checks
- **Rate Limiting:** Per-user-type request limits
- **Exam Grading:** AI-powered IELTS/TOEIC marking system

## 🔐 Security Features

- JWT authentication with refresh tokens
- Password hashing with bcrypt
- Rate limiting by user role
- Input validation and sanitization
- Security headers (helmet.js)
- Audit logging for sensitive operations

## 🐳 Docker Services

The `docker-compose.yml` includes:
- **PostgreSQL:** Main database
- **Redis:** Caching and sessions
- **Redis Commander:** Web UI for Redis (port 8081)

## 🚨 Troubleshooting

### Database Connection Issues
```bash
# Check if PostgreSQL is running
docker-compose ps

# View database logs
docker-compose logs postgres

# Reset database
npm run db:reset
```

### Redis Connection Issues
```bash
# Test Redis connection
docker exec -it agent_english_teacher_redis redis-cli ping

# Check Redis logs
docker-compose logs redis
```

### Server Won't Start
```bash
# Check for missing dependencies
npm install

# Generate Prisma client
npm run db:generate

# Check TypeScript errors
npm run build
```

## 📝 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `DATABASE_URL` | PostgreSQL connection | Required |
| `JWT_SECRET` | JWT signing key | Required (32+ chars) |
| `REDIS_PASSWORD` | Redis password | Optional |
| `LOG_LEVEL` | Logging level | `info` |

## 🤝 Development

1. **Install dependencies:** `npm install`
2. **Start services:** `docker-compose up -d`
3. **Setup database:** `npm run db:migrate && npm run db:seed`
4. **Start development:** `npm run dev`
5. **View database:** `npm run db:studio`

## 📄 License

MIT License - see LICENSE file for details.

---

**🚀 Ready to build amazing English learning experiences!** 