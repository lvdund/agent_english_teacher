# 🧪 Backend API Testing Guide

## 🚀 Step 1: Start the Server

```bash
npm run dev
```

**Expected Output:**
```
🚀 Server running on localhost:3001
🔴 Redis: Connected and ready
🐘 PostgreSQL: Connected and ready
```

## 🏥 Step 2: Health Check

```bash
curl http://localhost:3001/health
```

**Expected Response:**
```json
{
  "status": "OK",
  "timestamp": "2025-01-10T...",
  "uptime": 1234.567,
  "environment": "development",
  "services": {
    "database": { 
      "status": "connected",
      "version": "14.x"
    },
    "redis": { 
      "status": "connected" 
    }
  },
  "system": {
    "nodeVersion": "v18.x.x",
    "platform": "linux",
    "memory": {
      "used": "50MB",
      "total": "120MB"
    }
  }
}
```

## 🔐 Step 3: Authentication (Setup Users)

### 3.1 Register a Teacher
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teacher@example.com",
    "password": "Teacher123!",
    "firstName": "Jane",
    "lastName": "Smith",
    "role": "TEACHER"
  }'
```

**Expected Response:**
```json
{
  "status": "success",
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "user_id_here",
      "email": "teacher@example.com",
      "firstName": "Jane",
      "lastName": "Smith",
      "role": "TEACHER",
      "isActive": true,
      "classIds": []
    },
    "tokens": {
      "accessToken": "jwt_token_here",
      "refreshToken": "refresh_token_here",
      "expiresIn": 3600
    }
  }
}
```

**Save the `accessToken` from response for teacher operations!**

### 3.2 Register a Student
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@example.com",
    "password": "Student123!",
    "firstName": "John",
    "lastName": "Doe",
    "role": "STUDENT"
  }'
```

**Save the `accessToken` from response for student operations!**

### 3.3 Register Another Student
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student2@example.com",
    "password": "Student123!",
    "firstName": "Alice",
    "lastName": "Johnson",
    "role": "STUDENT"
  }'
```

### 3.4 Login User
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teacher@example.com",
    "password": "Teacher123!"
  }'
```

### 3.5 Get Current User (Auth Me)
```bash
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 3.6 Validate Token
```bash
curl -X GET http://localhost:3001/api/auth/validate \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 3.7 Refresh Token
```bash
curl -X POST http://localhost:3001/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "REFRESH_TOKEN_HERE"
  }'
```

### 3.8 Change Password
```bash
curl -X PUT http://localhost:3001/api/auth/change-password \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "Teacher123!",
    "newPassword": "NewPassword123!"
  }'
```

### 3.9 Forgot Password
```bash
curl -X POST http://localhost:3001/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teacher@example.com"
  }'
```

### 3.10 Logout All Devices
```bash
curl -X POST http://localhost:3001/api/auth/logout-all \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 3.11 Logout
```bash
curl -X POST http://localhost:3001/api/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "REFRESH_TOKEN_HERE"
  }'
```

## 👤 Step 4: Test User Management APIs

**Replace `TEACHER_TOKEN` and `STUDENT_TOKEN` with actual tokens from Step 3**

### 4.1 Get User Profile
```bash
# Teacher profile
curl -X GET http://localhost:3001/api/users/profile \
  -H "Authorization: Bearer TEACHER_TOKEN"

# Student profile  
curl -X GET http://localhost:3001/api/users/profile \
  -H "Authorization: Bearer STUDENT_TOKEN"
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "user": {
      "id": "user_id",
      "email": "teacher@example.com",
      "firstName": "Jane",
      "lastName": "Smith",
      "role": "TEACHER",
      "isActive": true,
      "avatar": null,
      "preferences": {},
      "createdAt": "2025-01-10T...",
      "updatedAt": "2025-01-10T...",
      "memberships": [],
      "stats": {
        "sentMessages": 0,
        "aiInteractions": 0,
        "examSubmissions": 0
      }
    }
  }
}
```

### 4.2 Update User Profile
```bash
curl -X PUT http://localhost:3001/api/users/profile \
  -H "Authorization: Bearer STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Johnny",
    "preferences": {
      "language": "en",
      "theme": "dark",
      "notifications": {
        "email": true,
        "push": false
      }
    }
  }'
```

### 4.3 Search Users (Teacher Only)
```bash
curl -X GET "http://localhost:3001/api/users/search?q=john&role=STUDENT" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 4.4 Get User's Classes
```bash
curl -X GET http://localhost:3001/api/users/classes \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 4.5 Get User by ID
```bash
curl -X GET http://localhost:3001/api/users/USER_ID \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 4.6 Update User Status (Admin Only)
```bash
curl -X PATCH http://localhost:3001/api/users/USER_ID/status \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "isActive": false
  }'
```

## 🏫 Step 5: Test Class Management APIs

### 5.1 Create a Class (Teacher)
```bash
curl -X POST http://localhost:3001/api/classes \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Advanced English Conversation",
    "description": "Practice advanced English speaking with AI assistance and peer interaction"
  }'
```

**Expected Response:**
```json
{
  "status": "success",
  "message": "Class created successfully",
  "data": {
    "class": {
      "id": "class_id_here",
      "name": "Advanced English Conversation",
      "description": "Practice advanced English speaking with AI assistance and peer interaction",
      "code": "ABC123",
      "teacherId": "teacher_id",
      "status": "ACTIVE",
      "createdAt": "2025-01-10T...",
      "updatedAt": "2025-01-10T..."
    }
  }
}
```

**Save the `class.code` from response for joining!**

### 5.2 Get All Classes
```bash
# Teacher view (can see their classes)
curl -X GET http://localhost:3001/api/classes \
  -H "Authorization: Bearer TEACHER_TOKEN"

# Student view (initially empty)
curl -X GET http://localhost:3001/api/classes \
  -H "Authorization: Bearer STUDENT_TOKEN"
```

### 5.3 Join Class (Student)
```bash
# Replace CLASS_CODE with the code from step 5.1
curl -X POST http://localhost:3001/api/classes/join \
  -H "Authorization: Bearer STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "classCode": "CLASS_CODE"
  }'

# Second student joins the same class
curl -X POST http://localhost:3001/api/classes/join \
  -H "Authorization: Bearer STUDENT2_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "classCode": "CLASS_CODE"
  }'
```

### 5.4 Get Class Details
```bash
# Replace CLASS_ID with actual class ID
curl -X GET http://localhost:3001/api/classes/CLASS_ID \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 5.5 Update Class (Teacher)
```bash
curl -X PUT http://localhost:3001/api/classes/CLASS_ID \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Advanced English Conversation - Updated",
    "description": "Updated description with more details about AI-powered learning"
  }'
```

### 5.6 Get Class Analytics (Teacher)
```bash
curl -X GET http://localhost:3001/api/classes/CLASS_ID/analytics \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 5.7 Remove Student from Class (Teacher)
```bash
curl -X DELETE http://localhost:3001/api/classes/CLASS_ID/members/STUDENT_USER_ID \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

## 💬 Step 6: Test Message APIs

### 6.1 Get Class Messages
```bash
curl -X GET http://localhost:3001/api/classes/CLASS_ID/messages \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 6.2 Create Class Message
```bash
curl -X POST http://localhost:3001/api/classes/CLASS_ID/messages \
  -H "Authorization: Bearer STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello everyone! This is my first message in the class.",
    "type": "text"
  }'
```

## 🔍 Step 7: Test Advanced Features

### 7.1 Search Users in Specific Class
```bash
curl -X GET "http://localhost:3001/api/users/search?classId=CLASS_ID&role=STUDENT" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 7.2 Get User by ID (Teacher viewing student)
```bash
curl -X GET http://localhost:3001/api/users/STUDENT_USER_ID \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 7.3 Search with Multiple Filters
```bash
curl -X GET "http://localhost:3001/api/users/search?q=alice&role=STUDENT&isActive=true&page=1&limit=10" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 7.4 Get Classes with Search and Pagination
```bash
curl -X GET "http://localhost:3001/api/classes?search=english&page=1&limit=10" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

## 🚫 Step 8: Test Authorization (These Should Fail)

### 8.1 Student Trying to Create Class (Should Fail)
```bash
curl -X POST http://localhost:3001/api/classes \
  -H "Authorization: Bearer STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Unauthorized Class"}'
```

**Expected: 403 Forbidden**

### 8.2 Student Trying to Search Users (Should Fail)
```bash
curl -X GET http://localhost:3001/api/users/search \
  -H "Authorization: Bearer STUDENT_TOKEN"
```

**Expected: 403 Forbidden**

### 8.3 No Token Request (Should Fail)
```bash
curl -X GET http://localhost:3001/api/users/profile
```

**Expected: 401 Unauthorized**

### 8.4 Invalid Token (Should Fail)
```bash
curl -X GET http://localhost:3001/api/users/profile \
  -H "Authorization: Bearer invalid_token_here"
```

**Expected: 401 Unauthorized**

### 8.5 Accessing Class Without Membership (Should Fail)
```bash
# Create another class and try to access with non-member
curl -X GET http://localhost:3001/api/classes/DIFFERENT_CLASS_ID \
  -H "Authorization: Bearer STUDENT_TOKEN"
```

**Expected: 403 Forbidden**

## ✅ Step 9: Verify Expected Responses

### ✅ Successful Responses Should Include:
- `status: "success"`
- Proper data structure
- Correct pagination info (where applicable)
- User permissions and role information

### ❌ Error Responses Should Include:
- `status: "error"`
- Meaningful error messages
- Proper HTTP status codes (400, 401, 403, 404, etc.)

## 📊 Step 10: Test Data Validation

### 10.1 Invalid Registration
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "invalid-email",
    "password": "weak",
    "firstName": "",
    "role": "INVALID_ROLE"
  }'
```

### 10.2 Invalid Class Creation
```bash
curl -X POST http://localhost:3001/api/classes \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AB"
  }'
```

**Expected: Validation errors**

### 10.3 Join Class with Invalid Code
```bash
curl -X POST http://localhost:3001/api/classes/join \
  -H "Authorization: Bearer STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "classCode": "INVALID"
  }'
```

**Expected: 404 Not Found or similar error**

## 🎯 Step 11: Performance Testing

### 11.1 Pagination Test
```bash
curl -X GET "http://localhost:3001/api/users/search?page=1&limit=5" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 11.2 Search Performance
```bash
curl -X GET "http://localhost:3001/api/users/search?q=test&role=STUDENT&page=1&limit=10" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

### 11.3 Class Pagination
```bash
curl -X GET "http://localhost:3001/api/classes?page=1&limit=10&status=ACTIVE" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

---

## 📝 Testing Checklist

- [ ] Server starts without errors
- [ ] Health check passes
- [ ] User registration works for both roles
- [ ] User authentication and token generation works
- [ ] Token validation and refresh works
- [ ] Profile management (get/update) works
- [ ] Password change functionality works
- [ ] Class creation works (teacher only)
- [ ] Class joining works (students)
- [ ] Class details and member listing works
- [ ] Message creation and retrieval works
- [ ] User search works (teacher only)
- [ ] Class analytics works (teacher only)
- [ ] Authorization properly blocks unauthorized access
- [ ] Data validation works correctly
- [ ] Error responses are meaningful
- [ ] Pagination works correctly

## 🛠️ Debugging Tips

1. **Check server logs** for detailed error information
2. **Verify tokens** are being passed correctly in Authorization headers
3. **Check database** using `npm run db:studio` for data persistence
4. **Use `-v` flag** with curl for verbose output: `curl -v ...`
5. **Check response headers** for additional debugging info
6. **Test rate limiting** by making multiple requests quickly
7. **Verify environment variables** are properly set

## 🔧 Common Issues

### Token Issues
- **Error**: 401 Unauthorized
- **Fix**: Re-run registration endpoints to refresh tokens
- **Check**: Token format should be `Bearer <token>`

### Database Issues  
- **Error**: 503 Service Unavailable
- **Fix**: Ensure PostgreSQL and Redis are running via Docker
- **Check**: Health endpoint shows connected services

### Variable Not Set
- **Error**: `{{variableName}}` appears in requests
- **Fix**: Check environment is selected and run prerequisite requests

### Class Code Issues
- **Error**: Invalid class code
- **Fix**: Use the exact code from class creation response
- **Check**: Codes are case-sensitive and must be exactly as generated

---

**Happy Testing! 🎉** 