# 📮 Postman Setup Guide

## 📁 Files Created

- `postman-collection.json` - Complete API collection with all current endpoints
- `postman-environment.json` - Development environment variables
- `test-apis.md` - Manual testing guide (backup reference)

## 🚀 How to Import into Postman

### Step 1: Import Collection
1. Open **Postman**
2. Click **Import** button (top left)
3. Drag and drop `postman-collection.json` OR click **Upload Files** and select it
4. Click **Import**

### Step 2: Import Environment
1. Click **Import** again
2. Drag and drop `postman-environment.json` OR select it via **Upload Files**
3. Click **Import**
4. In the top-right corner, select **"Agent English Teacher - Development"** environment

### Step 3: Verify Setup
- Collection should appear in left sidebar: **"Agent English Teacher - Backend APIs"**
- Environment should be active in top-right dropdown
- Variables like `{{baseUrl}}` should be available

## 📋 Collection Structure

### 🏥 Health Check
- Basic server health verification with detailed system information

### 🔐 Authentication
- **Register Teacher** - Auto-saves `teacherToken`
- **Register Student 1** - Auto-saves `studentToken` 
- **Register Student 2** - Auto-saves `student2Token`
- **Login Teacher** - Updates tokens
- **Get Current User (Auth Me)** - Verify authentication
- **Validate Token** - Check token validity
- **Refresh Token** - Token renewal
- **Change Password** - Update user password
- **Forgot Password** - Password reset request
- **Logout All Devices** - Revoke all tokens
- **Logout** - Session termination

### 👤 User Management
- **Get/Update Profile** - User profile operations
- **Search Users** - Teacher-only user search with filters
- **Get User by ID** - Individual user details
- **Get User's Classes** - Class memberships
- **Update User Status** - Admin-only user activation/deactivation

### 🏫 Class Management
- **Create Class** - Auto-saves `classId` and `classCode`
- **Get All Classes** - List classes (role-filtered)
- **Join Class** - Student class enrollment
- **Get Class Details** - Full class information
- **Update Class** - Modify class details
- **Get Class Analytics** - Teacher analytics
- **Remove Student** - Class membership management
- **Get Class Messages** - Retrieve class chat messages
- **Create Class Message** - Send messages in class

### 🚫 Authorization Tests
- **Student Try Create Class** - Should return 403
- **Student Try Search Users** - Should return 403
- **No Token Request** - Should return 401
- **Invalid Token** - Should return 401

### 📊 Data Validation Tests
- **Invalid Registration** - Bad data validation
- **Invalid Class Creation** - Input validation
- **Join with Invalid Code** - Error handling

### 🎯 Advanced Features
- **Search Users in Class** - Filtered search
- **Search with Multiple Filters** - Complex queries
- **Get Classes with Search** - Class search and pagination

## 🔄 Testing Workflow

### Recommended Order:
1. **🏥 Health Check** - Verify server is running
2. **🔐 Authentication** - Register all users first
   - Run "Register Teacher" → saves `teacherToken`
   - Run "Register Student 1" → saves `studentToken`
   - Run "Register Student 2" → saves `student2Token`
3. **🏫 Class Management** - Create and setup classes
   - Run "Create Class (Teacher)" → saves `classId` and `classCode`
   - Run "Join Class (Student 1)" 
   - Run "Join Class (Student 2)"
4. **💬 Message Testing** - Test messaging functionality
   - Run "Get Class Messages"
   - Run "Create Class Message"
5. **👤 User Management** - Test user operations
6. **🎯 Advanced Features** - Test complex scenarios
7. **🚫 Authorization Tests** - Verify security
8. **📊 Data Validation** - Test error handling

## ⚡ Auto-Variable Management

The collection includes **automatic variable setting** via test scripts:

```javascript
// Example: After registration, this runs automatically:
if (pm.response.code === 201) {
    const response = pm.response.json();
    pm.environment.set('teacherToken', response.data.tokens.accessToken);
    pm.environment.set('teacherId', response.data.user.id);
}
```

**Variables automatically set:**
- `teacherToken`, `studentToken`, `student2Token`, `adminToken`
- `teacherId`, `studentId`, `student2Id`, `adminId`
- `classId`, `classCode`
- `messageId` (for message operations)
- All refresh tokens

## 🔧 Manual Variable Updates

If needed, you can manually update variables:
1. Click the **Environment** dropdown (top-right)
2. Click the **eye icon** 👁️ 
3. Click **Edit** 
4. Update values as needed

## 📊 Expected Responses

### ✅ Success Responses (200/201)
```json
{
  "status": "success",
  "message": "Operation completed successfully",
  "data": { /* relevant data */ }
}
```

### ❌ Error Responses (400/401/403/404)
```json
{
  "status": "error",
  "message": "Descriptive error message",
  "errors": ["Specific validation errors"]
}
```

## 🛠️ Troubleshooting

### Server Not Running
- **Error**: Connection refused
- **Fix**: Run `npm run dev` in project directory
- **Check**: Health endpoint returns 200 with service statuses

### Token Issues
- **Error**: 401 Unauthorized
- **Fix**: Re-run registration endpoints to refresh tokens
- **Check**: Ensure Bearer format: `Bearer <token>`

### Variable Not Set
- **Error**: `{{variableName}}` appears in requests
- **Fix**: Check environment is selected and run prerequisite requests

### Database Issues  
- **Error**: 503 Service Unavailable
- **Fix**: Ensure PostgreSQL and Redis are running via Docker
- **Check**: Health endpoint shows all services as "connected"

### Class Code Issues
- **Error**: Class not found
- **Fix**: Use exact code from class creation response
- **Check**: Codes are case-sensitive (e.g., "ABC123")

### Rate Limiting
- **Error**: 429 Too Many Requests
- **Fix**: Wait before making more requests
- **Check**: Especially affects auth endpoints

## 🎯 Quick Test Commands

### Full Test Sequence (Run in Order):
1. Health Check
2. Register Teacher
3. Register Student 1
4. Register Student 2  
5. Create Class (Teacher)
6. Join Class (Student 1)
7. Join Class (Student 2)
8. Get Class Details
9. Create Class Message
10. Get Class Messages
11. Get Class Analytics
12. Search Users (Teacher)

### Authorization Test Sequence:
1. Student Try Create Class (Should fail)
2. Student Try Search Users (Should fail)  
3. No Token Request (Should fail)
4. Invalid Token (Should fail)

### Advanced Feature Tests:
1. Search Users in Specific Class
2. Search with Multiple Filters
3. Get Classes with Search
4. Update User Profile
5. Get User by ID

## 📈 Performance Testing

Use Postman's **Collection Runner** for batch testing:
1. Click **Collections** → **Agent English Teacher - Backend APIs**
2. Click **Run collection**
3. Select requests to run
4. Set iterations and delay
5. Click **Run Agent English Teacher - Backend APIs**

### Performance Test Scenarios:
- **Load Test**: Run full sequence 10 times with 1s delay
- **Pagination Test**: Test various page sizes (5, 10, 20, 50)
- **Search Test**: Test different search queries and filters
- **Concurrent Users**: Simulate multiple students joining same class

## 🔍 API Coverage

### Authentication Endpoints ✅
- [x] POST /api/auth/register
- [x] POST /api/auth/login
- [x] POST /api/auth/logout
- [x] POST /api/auth/logout-all
- [x] POST /api/auth/refresh
- [x] PUT /api/auth/change-password
- [x] POST /api/auth/forgot-password
- [x] GET /api/auth/me
- [x] GET /api/auth/validate

### User Management Endpoints ✅
- [x] GET /api/users/profile
- [x] PUT /api/users/profile
- [x] GET /api/users/classes
- [x] GET /api/users/search
- [x] GET /api/users/:id
- [x] PATCH /api/users/:id/status

### Class Management Endpoints ✅
- [x] POST /api/classes
- [x] GET /api/classes
- [x] POST /api/classes/join
- [x] GET /api/classes/:id
- [x] PUT /api/classes/:id
- [x] GET /api/classes/:id/analytics
- [x] DELETE /api/classes/:id/members/:userId

### Message Endpoints ✅
- [x] GET /api/classes/:classId/messages
- [x] POST /api/classes/:classId/messages

### Health Check ✅
- [x] GET /health

## 🎉 Happy Testing!

The collection provides comprehensive coverage of all current backend APIs with:
- Automatic token management
- Realistic test scenarios
- Error condition testing
- Performance benchmarking
- Complete workflow validation

**Next Steps**: After Phase 4 completion, this collection will be extended for:
- Phase 5: Real-time messaging with WebSocket tests
- Phase 6: AI integration endpoints
- Phase 7: File upload and management
- Phase 8: Assessment and analytics 