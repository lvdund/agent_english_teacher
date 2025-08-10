import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clear existing data (development only)
  console.log('🗑️ Cleaning existing data...');
  await prisma.aIInteraction.deleteMany({});
  await prisma.examSubmission.deleteMany({});
  await prisma.fileAttachment.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.classMembership.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.class.deleteMany({});
  await prisma.user.deleteMany({});

  // Create sample users
  console.log('👥 Creating users...');
  
  // Hash password for all users
  const hashedPassword = await bcrypt.hash('password123', 12);

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      email: 'admin@englishteacher.com',
      password: hashedPassword,
      firstName: 'Admin',
      lastName: 'User',
      role: 'ADMIN',
      bio: 'System administrator',
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
          maxTokens: 1000,
          temperature: 0.7,
        },
      },
    },
  });

  // Create teachers
  const teacher1 = await prisma.user.create({
    data: {
      email: 'sarah.teacher@englishteacher.com',
      password: hashedPassword,
      firstName: 'Sarah',
      lastName: 'Johnson',
      role: 'TEACHER',
      bio: 'Experienced English teacher specializing in IELTS preparation',
      preferences: {
        language: 'en',
        timezone: 'America/New_York',
        notifications: {
          email: true,
          push: true,
          newMessages: true,
          classUpdates: true,
        },
        aiSettings: {
          model: 'gpt-4',
          maxTokens: 1500,
          temperature: 0.6,
        },
      },
    },
  });

  const teacher2 = await prisma.user.create({
    data: {
      email: 'michael.teacher@englishteacher.com',
      password: hashedPassword,
      firstName: 'Michael',
      lastName: 'Brown',
      role: 'TEACHER',
      bio: 'English conversation and business English specialist',
      preferences: {
        language: 'en',
        timezone: 'Europe/London',
        notifications: {
          email: true,
          push: false,
          newMessages: true,
          classUpdates: true,
        },
        aiSettings: {
          model: 'gpt-4',
          maxTokens: 1200,
          temperature: 0.8,
        },
      },
    },
  });

  // Create students
  const students = await Promise.all([
    prisma.user.create({
      data: {
        email: 'alice.student@example.com',
        password: hashedPassword,
        firstName: 'Alice',
        lastName: 'Smith',
        role: 'STUDENT',
        bio: 'Preparing for IELTS exam',
        preferences: {
          language: 'en',
          timezone: 'Asia/Tokyo',
          notifications: {
            email: true,
            push: true,
            newMessages: true,
            classUpdates: false,
          },
          aiSettings: {
            model: 'gpt-4',
            maxTokens: 800,
            temperature: 0.7,
          },
        },
      },
    }),
    prisma.user.create({
      data: {
        email: 'bob.student@example.com',
        password: hashedPassword,
        firstName: 'Bob',
        lastName: 'Wilson',
        role: 'STUDENT',
        bio: 'Business English learner',
        preferences: {
          language: 'en',
          timezone: 'America/Los_Angeles',
          notifications: {
            email: false,
            push: true,
            newMessages: true,
            classUpdates: true,
          },
          aiSettings: {
            model: 'gpt-4',
            maxTokens: 600,
            temperature: 0.8,
          },
        },
      },
    }),
    prisma.user.create({
      data: {
        email: 'chen.student@example.com',
        password: hashedPassword,
        firstName: 'Chen',
        lastName: 'Li',
        role: 'STUDENT',
        bio: 'Intermediate English learner',
        preferences: {
          language: 'en',
          timezone: 'Asia/Shanghai',
          notifications: {
            email: true,
            push: true,
            newMessages: true,
            classUpdates: true,
          },
          aiSettings: {
            model: 'gpt-4',
            maxTokens: 700,
            temperature: 0.7,
          },
        },
      },
    }),
  ]);

  // Create classes
  console.log('🏫 Creating classes...');
  
  const class1 = await prisma.class.create({
    data: {
      name: 'IELTS Preparation - Advanced',
      description: 'Advanced IELTS preparation focusing on writing and speaking skills',
      code: 'IELTS-ADV-001',
      status: 'ACTIVE',
      teacherId: teacher1.id,
      settings: {
        allowFileUploads: true,
        maxFileSize: 10485760, // 10MB
        allowedFileTypes: ['pdf', 'doc', 'docx', 'txt', 'jpg', 'png'],
        aiAssistanceEnabled: true,
        examMarkingEnabled: true,
      },
    },
  });

  const class2 = await prisma.class.create({
    data: {
      name: 'Business English Conversation',
      description: 'Practical business English for professionals',
      code: 'BIZ-ENG-002',
      status: 'ACTIVE',
      teacherId: teacher2.id,
      settings: {
        allowFileUploads: true,
        maxFileSize: 5242880, // 5MB
        allowedFileTypes: ['pdf', 'doc', 'txt'],
        aiAssistanceEnabled: true,
        examMarkingEnabled: false,
      },
    },
  });

  const class3 = await prisma.class.create({
    data: {
      name: 'General English - Intermediate',
      description: 'General English skills for intermediate learners',
      code: 'GEN-INT-003',
      status: 'ACTIVE',
      teacherId: teacher1.id,
      settings: {
        allowFileUploads: true,
        maxFileSize: 10485760,
        allowedFileTypes: ['pdf', 'doc', 'docx', 'txt', 'jpg', 'png', 'mp3'],
        aiAssistanceEnabled: true,
        examMarkingEnabled: true,
      },
    },
  });

  // Create class memberships
  console.log('👥 Creating class memberships...');
  
  await Promise.all([
    // Teacher memberships
    prisma.classMembership.create({
      data: {
        userId: teacher1.id,
        classId: class1.id,
        role: 'TEACHER',
        permissions: {
          canManageStudents: true,
          canViewAllChats: true,
          canModerateContent: true,
          canAccessAnalytics: true,
        },
      },
    }),
    prisma.classMembership.create({
      data: {
        userId: teacher2.id,
        classId: class2.id,
        role: 'TEACHER',
        permissions: {
          canManageStudents: true,
          canViewAllChats: true,
          canModerateContent: true,
          canAccessAnalytics: true,
        },
      },
    }),
    prisma.classMembership.create({
      data: {
        userId: teacher1.id,
        classId: class3.id,
        role: 'TEACHER',
        permissions: {
          canManageStudents: true,
          canViewAllChats: true,
          canModerateContent: true,
          canAccessAnalytics: true,
        },
      },
    }),

    // Student memberships
    prisma.classMembership.create({
      data: {
        userId: students[0].id, // Alice
        classId: class1.id,
        role: 'STUDENT',
        permissions: {
          canSendMessages: true,
          canUploadFiles: true,
          canUseAI: true,
        },
      },
    }),
    prisma.classMembership.create({
      data: {
        userId: students[0].id, // Alice
        classId: class3.id,
        role: 'STUDENT',
        permissions: {
          canSendMessages: true,
          canUploadFiles: true,
          canUseAI: true,
        },
      },
    }),
    prisma.classMembership.create({
      data: {
        userId: students[1].id, // Bob
        classId: class2.id,
        role: 'STUDENT',
        permissions: {
          canSendMessages: true,
          canUploadFiles: true,
          canUseAI: true,
        },
      },
    }),
    prisma.classMembership.create({
      data: {
        userId: students[2].id, // Chen
        classId: class3.id,
        role: 'STUDENT',
        permissions: {
          canSendMessages: true,
          canUploadFiles: true,
          canUseAI: true,
        },
      },
    }),
  ]);

  // Create sample messages
  console.log('💬 Creating sample messages...');
  
  const message1 = await prisma.message.create({
    data: {
      content: 'Welcome to IELTS Preparation class! Please introduce yourself and let me know your target IELTS score.',
      type: 'SYSTEM',
      senderId: teacher1.id,
      classId: class1.id,
      metadata: {
        isWelcomeMessage: true,
        priority: 'high',
      },
    },
  });

  const message2 = await prisma.message.create({
    data: {
      content: 'Hello everyone! My name is Alice and I am preparing for IELTS. My target score is 7.5 overall. I particularly struggle with writing Task 2.',
      type: 'TEXT',
      senderId: students[0].id,
      classId: class1.id,
      parentMessageId: message1.id,
      metadata: {
        studentIntroduction: true,
      },
    },
  });

  const message3 = await prisma.message.create({
    data: {
      content: 'Hi Bob! Welcome to Business English class. Today we will focus on email communication and presentation skills.',
      type: 'TEXT',
      senderId: teacher2.id,
      classId: class2.id,
      metadata: {
        lessonTopic: 'email_communication',
      },
    },
  });

  // Create sample AI interactions
  console.log('🤖 Creating AI interactions...');
  
  await Promise.all([
    prisma.aIInteraction.create({
      data: {
        userId: students[0].id,
        classId: class1.id,
        messageId: message2.id,
        model: 'gpt-4',
        prompt: 'Can you help me improve this IELTS writing task 2 essay?',
        response: 'I\'d be happy to help you improve your IELTS Writing Task 2 essay! Please share your essay draft, and I\'ll provide specific feedback on structure, vocabulary, grammar, and coherence.',
        tokens: 45,
        confidence: 0.92,
        type: 'GENERAL_HELP',
        corrections: [],
        suggestions: [
          'Focus on clear paragraph structure',
          'Use linking words for better coherence',
          'Vary your vocabulary to avoid repetition'
        ],
        processingTime: 1250,
      },
    }),
    prisma.aIInteraction.create({
      data: {
        userId: students[1].id,
        classId: class2.id,
        messageId: message3.id,
        model: 'gpt-4',
        prompt: 'Please check the grammar in this business email',
        response: 'I\'ve reviewed your business email. Here are some corrections and suggestions for improvement.',
        tokens: 78,
        confidence: 0.95,
        type: 'GRAMMAR_CHECK',
        corrections: [
          {
            original: 'I am writing to inform you about the meeting.',
            corrected: 'I am writing to inform you about the upcoming meeting.',
            explanation: 'Added "upcoming" for clarity',
            type: 'clarity'
          }
        ],
        suggestions: [
          'Consider using more formal language',
          'Add a clear call to action'
        ],
        processingTime: 890,
      },
    }),
  ]);

  // Create sample exam submission
  console.log('📝 Creating exam submissions...');
  
  await prisma.examSubmission.create({
    data: {
      studentId: students[0].id,
      classId: class1.id,
      title: 'IELTS Writing Task 2 - Technology and Education',
      type: 'IELTS_WRITING',
      content: 'Some people believe that technology has made learning more accessible, while others argue that it has made students lazy. Discuss both views and give your opinion.\n\nIn today\'s digital age, technology has revolutionized many aspects of our lives, including education. While some individuals contend that technological advancements have enhanced learning accessibility, others maintain that these developments have contributed to student lethargy. This essay will examine both perspectives before presenting my viewpoint.\n\nProponents of educational technology argue that it has democratized learning opportunities...',
      submittedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      gradedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
      isGraded: true,
      grade: {
        overall: 7.0,
        breakdown: [
          {
            criterion: 'Task Achievement',
            score: 7,
            feedback: 'Good response to the task with clear position and well-developed ideas'
          },
          {
            criterion: 'Coherence and Cohesion',
            score: 7,
            feedback: 'Clear progression with appropriate linking words'
          },
          {
            criterion: 'Lexical Resource',
            score: 7,
            feedback: 'Good range of vocabulary with some sophisticated usage'
          },
          {
            criterion: 'Grammatical Range and Accuracy',
            score: 7,
            feedback: 'Variety of complex structures with good control'
          }
        ],
        feedback: 'This is a well-structured essay that addresses the task effectively. Your arguments are clearly presented and supported with relevant examples.',
        improvements: [
          'Try to include more sophisticated vocabulary in body paragraphs',
          'Ensure all examples directly support your main points',
          'Consider varying sentence structures more in the conclusion'
        ],
        strengths: [
          'Clear introduction with thesis statement',
          'Balanced discussion of both views',
          'Good use of linking words',
          'Appropriate essay length'
        ]
      },
    },
  });

  console.log('✅ Database seeding completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`👤 Users created: ${3 + 3} (1 admin, 2 teachers, 3 students)`);
  console.log(`🏫 Classes created: 3`);
  console.log(`👥 Memberships created: 7`);
  console.log(`💬 Messages created: 3`);
  console.log(`🤖 AI interactions created: 2`);
  console.log(`📝 Exam submissions created: 1`);
  console.log('\n🔑 Login credentials (all users):');
  console.log('Password: password123');
  console.log('\n📧 Test accounts:');
  console.log('Admin: admin@englishteacher.com');
  console.log('Teacher 1: sarah.teacher@englishteacher.com');
  console.log('Teacher 2: michael.teacher@englishteacher.com');
  console.log('Student 1: alice.student@example.com');
  console.log('Student 2: bob.student@example.com');
  console.log('Student 3: chen.student@example.com');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 