import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Course } from './models/Course.model';
import { Curriculum } from './models/Curriculum.model';
import { User } from './models/User.model';
import { Batch } from './models/Batch.model';
import { Assignment } from './models/Assignment.model';
import { LiveClass } from './models/LiveClass.model';
import { Booking } from './models/Booking.model';
import { RecordedLecture } from './models/RecordedLecture.model';
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting } from './services/zoom.service';
import { syncRecordedLectureForLiveClass } from './services/recordedLectureSync.service';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/britInstiuteLMS';
const requestedSeedPassword = 'Pass@123';

const upsertSeedUser = async ({
  name,
  username,
  password,
  role,
  enrolledCourse,
  previousUsernames = [],
}: {
  name: string;
  username: string;
  password: string;
  role: 'teacher' | 'student';
  enrolledCourse?: mongoose.Types.ObjectId;
  previousUsernames?: string[];
}) => {
  const normalizedUsername = username.toLowerCase().trim();
  const usernameAliases = previousUsernames.map((item) => item.toLowerCase().trim()).filter(Boolean);
  let user: any = await User.findOne({ username: normalizedUsername }).select('+password');

  if (!user) {
    for (const alias of usernameAliases) {
      user = await User.findOne({ username: alias }).select('+password');
      if (user) break;
    }
  }

  if (!user) {
    user = await User.create({
      name,
      username: normalizedUsername,
      password,
      role,
      enrolledCourse,
      isActive: true,
    });
    console.log(`✅ ${role === 'teacher' ? 'Teacher' : 'Student'} created — username: ${username} | password: ${password}`);
    return user;
  }

  user.name = name;
  user.username = normalizedUsername;
  user.role = role;
  user.isActive = true;
  user.password = password;
  if (enrolledCourse) user.enrolledCourse = enrolledCourse;
  await user.save();
  console.log(`✅ ${role === 'teacher' ? 'Teacher' : 'Student'} updated — username: ${username} | password: ${password}`);
  return user;
};

const scheduledDate = (daysFromNow: number, hour: number, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
};

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const studentPassword = 'student123';
  const seededStudents: { courseTitle: string; name: string; username: string; password: string; id: string }[] = [];

  const defaultCurriculums = [
    {
      title: 'Data Analytics with Generative AI (6 Months)',
      description: 'Data analytics foundations with automation, visualization, and GenAI workflows.',
      modules: [
        {
          title: 'Module 1: Analytics Foundations',
          topics: [
            { title: 'Excel for Data Analysis', duration: 90 },
            { title: 'SQL Basics', duration: 90 },
            { title: 'Python for Analytics', duration: 120 },
          ],
        },
        {
          title: 'Module 2: Visualization and Reporting',
          topics: [
            { title: 'Power BI Fundamentals', duration: 120 },
            { title: 'Dashboard Design', duration: 90 },
            { title: 'Storytelling with Data', duration: 90 },
          ],
        },
        {
          title: 'Module 3: Generative AI for Analysts',
          topics: [
            { title: 'Prompting for Analysts', duration: 90 },
            { title: 'Automating Reports with GenAI', duration: 120 },
            { title: 'Analytics Capstone', duration: 120 },
          ],
        },
      ],
    },
    {
      title: 'Data Science & Machine Learning (12 Months)',
      description: 'Statistics, Python, machine learning, model deployment, and applied projects.',
      modules: [
        {
          title: 'Module 1: Python and Statistics',
          topics: [
            { title: 'Python Essentials', duration: 120 },
            { title: 'Statistics for Data Science', duration: 120 },
            { title: 'EDA with Pandas', duration: 90 },
          ],
        },
        {
          title: 'Module 2: Machine Learning',
          topics: [
            { title: 'Supervised Learning', duration: 120 },
            { title: 'Unsupervised Learning', duration: 120 },
            { title: 'Model Evaluation', duration: 90 },
          ],
        },
        {
          title: 'Module 3: Deep Learning and MLOps',
          topics: [
            { title: 'Neural Networks', duration: 120 },
            { title: 'Deep Learning Projects', duration: 120 },
            { title: 'Deployment and Monitoring', duration: 120 },
          ],
        },
      ],
    },
    {
      title: 'Agentic AI (4 Months)',
      description: 'Tool-using AI agents, orchestration, evaluation, and deployment patterns.',
      modules: [
        {
          title: 'Module 1: Agent Basics',
          topics: [
            { title: 'Agent Architectures', duration: 90 },
            { title: 'Prompt Flows and Planning', duration: 90 },
            { title: 'Memory and State', duration: 90 },
          ],
        },
        {
          title: 'Module 2: Tool Use and Automation',
          topics: [
            { title: 'Function Calling', duration: 120 },
            { title: 'Workflow Automation', duration: 90 },
            { title: 'Multi-Step Agents', duration: 120 },
          ],
        },
        {
          title: 'Module 3: Evaluation and Deployment',
          topics: [
            { title: 'Agent Evaluation', duration: 90 },
            { title: 'Safety and Guardrails', duration: 90 },
            { title: 'Production Agent Project', duration: 120 },
          ],
        },
      ],
    },
    {
      title: 'Generative AI (3 Months)',
      description: 'LLMs, prompting, embeddings, RAG, and applied GenAI product building.',
      modules: [
        {
          title: 'Module 1: GenAI Foundations',
          topics: [
            { title: 'Introduction to LLMs', duration: 90 },
            { title: 'Prompt Engineering', duration: 90 },
            { title: 'Tokenization and Context', duration: 60 },
          ],
        },
        {
          title: 'Module 2: Building with GenAI',
          topics: [
            { title: 'Embeddings and Search', duration: 90 },
            { title: 'RAG Applications', duration: 120 },
            { title: 'AI App Prototyping', duration: 120 },
          ],
        },
        {
          title: 'Module 3: Deployment and Use Cases',
          topics: [
            { title: 'Evaluation Basics', duration: 90 },
            { title: 'Business Use Cases', duration: 90 },
            { title: 'Final GenAI Demo', duration: 120 },
          ],
        },
      ],
    },
  ];

  const superAdminExists = await db.collection('users').findOne({ username: 'superadmin' });
  let superAdminId = superAdminExists?._id;

  if (!superAdminExists) {
    const hashedPassword = await bcrypt.hash('superadmin123', 10);
    const result = await db.collection('users').insertOne({
      name: 'Super Admin',
      username: 'superadmin',
      password: hashedPassword,
      role: 'superadmin',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    superAdminId = result.insertedId;
    console.log('✅ Super Admin created — username: superadmin | password: superadmin123');
  } else {
    console.log('✅ Super Admin already exists');
  }

  const teacherExists = await User.findOne({ username: 'admin' }).select('+password');
  let teacherId = teacherExists?._id;

  if (!teacherExists) {
    const teacher = await User.create({
      name: 'Lead Teacher',
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      isActive: true,
    });
    teacherId = teacher._id;
    console.log('✅ Teacher created — username: admin | password: admin123');
  } else {
    teacherExists.name = teacherExists.name || 'Lead Teacher';
    teacherExists.role = 'admin';
    teacherExists.isActive = true;
    teacherExists.password = 'admin123';
    await teacherExists.save();
    teacherId = teacherExists._id;
    console.log('✅ Existing admin converted to Teacher — username: admin | password: admin123');
  }

  const requestedTeacher = await upsertSeedUser({
    name: 'Seed Teacher',
    username: 'teacher',
    password: requestedSeedPassword,
    role: 'teacher',
  });

  for (const item of defaultCurriculums) {
    let course = await Course.findOne({ title: item.title });
    if (!course) {
      course = await Course.create({
        title: item.title,
        description: item.description,
        createdBy: teacherId,
      });
      console.log(`✅ Course created: ${item.title}`);
    }

    const existingCurriculum = await Curriculum.findOne({ course: course._id, batch: null });
    if (!existingCurriculum) {
      await Curriculum.create({
        title: item.title,
        course: course._id,
        batch: null,
        modules: item.modules,
      });
      console.log(`✅ Default curriculum created: ${item.title}`);
    } else {
      console.log(`✅ Default curriculum already exists: ${item.title}`);
    }

    const batchName = `${item.title} - Test Batch`;
    let batch = await Batch.findOne({ name: batchName, course: course._id });
    if (!batch) {
      batch = await Batch.create({
        name: batchName,
        description: `Seeded test batch for ${item.title}`,
        course: course._id,
        students: [],
        isActive: true,
        startDate: new Date(),
        createdBy: teacherId,
      });
      console.log(`✅ Test batch created: ${batchName}`);
    } else {
      console.log(`✅ Test batch already exists: ${batchName}`);
    }

    const courseCode = item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const studentIds: mongoose.Types.ObjectId[] = [];

    for (let i = 1; i <= 5; i += 1) {
      const username = `${courseCode}-s${i}`;
      let student = await User.findOne({ username });

      if (!student) {
        student = await User.create({
          name: `${item.title} Student ${i}`,
          username,
          password: studentPassword,
          role: 'student',
          enrolledCourse: course._id,
          isActive: true,
        });
        console.log(`✅ Student created: ${username}`);
      } else {
        student.enrolledCourse = course._id;
        student.isActive = true;
        student.name = `${item.title} Student ${i}`;
        student.password = studentPassword;
        await student.save();
        console.log(`✅ Student updated: ${username}`);
      }

      studentIds.push(student._id as mongoose.Types.ObjectId);
      seededStudents.push({
        courseTitle: item.title,
        name: student.name,
        username: student.username,
        password: studentPassword,
        id: String(student._id),
      });
    }

    batch.students = studentIds;
    batch.isActive = true;
    await batch.save();
    console.log(`✅ Added 5 students to batch: ${batchName}`);

    const assignmentTemplates = [
      {
        title: `${item.title} - Practice Assignment`,
        description: 'Submit your class practice work. You can share a Google Drive link, file link, Git repo, or written notes.',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        attachmentUrl: 'https://drive.google.com/',
      },
      {
        title: `${item.title} - Mini Project Submission`,
        description: 'Upload your mini project with a short explanation of what you built and any blockers you faced.',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        attachmentUrl: 'https://docs.google.com/',
      },
    ];

    for (const assignmentData of assignmentTemplates) {
      const existingAssignment = await Assignment.findOne({ batch: batch._id, title: assignmentData.title });
      if (!existingAssignment) {
        await Assignment.create({
          ...assignmentData,
          batch: batch._id,
          createdBy: teacherId,
        });
        console.log(`✅ Test assignment created: ${assignmentData.title}`);
      } else {
        existingAssignment.description = assignmentData.description;
        existingAssignment.dueDate = assignmentData.dueDate;
        existingAssignment.attachmentUrl = assignmentData.attachmentUrl;
        await existingAssignment.save();
        console.log(`✅ Test assignment updated: ${assignmentData.title}`);
      }
    }
  }

  const seedTeacherId = requestedTeacher._id as mongoose.Types.ObjectId;
  const seedCourseTitle = 'Seeded Zoom Data Analytics Curriculum';
  const seedCourseDescription = 'Seeded course with curriculum, Zoom live classes, recorded lecture placeholders, and a 1:1 request.';
  let seedCourse = await Course.findOne({ title: seedCourseTitle });

  if (!seedCourse) {
    seedCourse = await Course.create({
      title: seedCourseTitle,
      description: seedCourseDescription,
      createdBy: seedTeacherId,
      isPublic: true,
      assignedTeachers: [],
    });
    console.log(`✅ Seed course created: ${seedCourseTitle}`);
  } else {
    seedCourse.description = seedCourseDescription;
    seedCourse.createdBy = seedTeacherId;
    seedCourse.isPublic = true;
    seedCourse.assignedTeachers = [];
    await seedCourse.save();
    console.log(`✅ Seed course updated: ${seedCourseTitle}`);
  }

  const requestedStudent = await upsertSeedUser({
    name: 'Vikas Kumar',
    username: 'vikas',
    password: requestedSeedPassword,
    role: 'student',
    enrolledCourse: seedCourse._id as mongoose.Types.ObjectId,
    previousUsernames: ['vikash'],
  });

  const seedBatchName = 'Seeded Zoom Data Analytics - Vikas Batch';
  const previousSeedBatchNames = ['Seeded Zoom Data Analytics - Vikash Batch'];
  let seedBatch = await Batch.findOne({ name: seedBatchName, course: seedCourse._id });
  if (!seedBatch) {
    for (const previousName of previousSeedBatchNames) {
      seedBatch = await Batch.findOne({ name: previousName, course: seedCourse._id });
      if (seedBatch) break;
    }
  }

  if (!seedBatch) {
    seedBatch = await Batch.create({
      name: seedBatchName,
      description: 'Seeded batch for Vikas with Zoom live classes and recorded lecture entries.',
      course: seedCourse._id,
      students: [requestedStudent._id],
      isActive: true,
      startDate: new Date(),
      createdBy: seedTeacherId,
    });
    console.log(`✅ Seed batch created: ${seedBatchName}`);
  } else {
    seedBatch.name = seedBatchName;
    seedBatch.description = 'Seeded batch for Vikas with Zoom live classes and recorded lecture entries.';
    seedBatch.students = [requestedStudent._id as mongoose.Types.ObjectId];
    seedBatch.isActive = true;
    seedBatch.createdBy = seedTeacherId;
    await seedBatch.save();
    console.log(`✅ Seed batch updated: ${seedBatchName}`);
  }

  const staleSeedBatches = await Batch.find({
    name: { $in: previousSeedBatchNames },
    course: seedCourse._id,
    _id: { $ne: seedBatch._id },
  });

  for (const staleBatch of staleSeedBatches) {
    const staleLiveClasses = await LiveClass.find({ batch: staleBatch._id });
    for (const staleLiveClass of staleLiveClasses) {
      if (staleLiveClass.zoomMeetingId) {
        try {
          await deleteZoomMeeting(staleLiveClass.zoomMeetingId);
        } catch (error) {
          console.warn(`⚠️ Could not delete stale Zoom meeting ${staleLiveClass.zoomMeetingId}: ${getErrorMessage(error)}`);
        }
      }
    }

    const staleLiveClassIds = staleLiveClasses.map((liveClass) => liveClass._id);
    await RecordedLecture.deleteMany({
      $or: [
        { batch: staleBatch._id },
        { liveClass: { $in: staleLiveClassIds } },
      ],
    });
    await LiveClass.deleteMany({ batch: staleBatch._id });
    await Curriculum.deleteMany({ batch: staleBatch._id, title: seedCourseTitle });
    await staleBatch.deleteOne();
    console.log(`✅ Removed stale seed batch: ${staleBatch.name}`);
  }

  const meetingSeeds = [
    {
      classNumber: 'Class 1',
      topic: 'Zoom Orientation and LMS Walkthrough',
      duration: 60,
      scheduledAt: scheduledDate(1, 20),
    },
    {
      classNumber: 'Class 2',
      topic: 'Analytics Foundations with Excel',
      duration: 75,
      scheduledAt: scheduledDate(2, 20),
    },
    {
      classNumber: 'Class 3',
      topic: 'Dashboard Planning and Reporting',
      duration: 90,
      scheduledAt: scheduledDate(3, 20),
    },
  ];

  const curriculumTopics = [];

  for (const meeting of meetingSeeds) {
    let liveClass = await LiveClass.findOne({
      batch: seedBatch._id,
      classNumber: meeting.classNumber,
      topic: meeting.topic,
    });

    let meetingLink = liveClass?.meetingLink || '';
    let zoomMeetingId = liveClass?.zoomMeetingId;
    let zoomMeetingUuid = liveClass?.zoomMeetingUuid;
    let zoomStartUrl = liveClass?.zoomStartUrl;

    if (zoomMeetingId) {
      await updateZoomMeeting(zoomMeetingId, {
        topic: `${meeting.classNumber} - ${meeting.topic}`,
        startTime: meeting.scheduledAt,
        duration: meeting.duration,
      });
    } else {
      const zoomMeeting = await createZoomMeeting({
        topic: `${meeting.classNumber} - ${meeting.topic}`,
        startTime: meeting.scheduledAt,
        duration: meeting.duration,
      });
      meetingLink = zoomMeeting.join_url;
      zoomMeetingId = String(zoomMeeting.id);
      zoomMeetingUuid = zoomMeeting.uuid;
      zoomStartUrl = zoomMeeting.start_url;
    }

    if (!liveClass) {
      liveClass = await LiveClass.create({
        batch: seedBatch._id,
        classNumber: meeting.classNumber,
        topic: meeting.topic,
        meetingLink,
        zoomMeetingId,
        zoomMeetingUuid,
        zoomStartUrl,
        scheduledAt: meeting.scheduledAt,
        duration: meeting.duration,
        status: 'scheduled',
        createdBy: seedTeacherId,
      });
      console.log(`✅ Seed Zoom class created: ${meeting.classNumber} - ${meeting.topic}`);
    } else {
      liveClass.meetingLink = meetingLink;
      liveClass.zoomMeetingId = zoomMeetingId;
      liveClass.zoomMeetingUuid = zoomMeetingUuid;
      liveClass.zoomStartUrl = zoomStartUrl;
      liveClass.scheduledAt = meeting.scheduledAt;
      liveClass.duration = meeting.duration;
      liveClass.status = 'scheduled';
      liveClass.createdBy = seedTeacherId;
      await liveClass.save();
      console.log(`✅ Seed Zoom class updated: ${meeting.classNumber} - ${meeting.topic}`);
    }

    await syncRecordedLectureForLiveClass(liveClass);

    curriculumTopics.push({
      title: meeting.topic,
      duration: meeting.duration,
      scheduledAt: meeting.scheduledAt,
      meetingLink,
      liveClassId: liveClass._id,
    });
  }

  let seedCurriculum = await Curriculum.findOne({ course: seedCourse._id, batch: seedBatch._id });
  const seedCurriculumModules = [
    {
      title: 'Module 1: Live Zoom Foundations',
      topics: curriculumTopics,
    },
  ];

  if (!seedCurriculum) {
    seedCurriculum = await Curriculum.create({
      title: seedCourseTitle,
      course: seedCourse._id,
      batch: seedBatch._id,
      modules: seedCurriculumModules,
    });
    console.log(`✅ Seed curriculum created: ${seedCourseTitle}`);
  } else {
    seedCurriculum.title = seedCourseTitle;
    seedCurriculum.modules = seedCurriculumModules;
    await seedCurriculum.save();
    console.log(`✅ Seed curriculum updated: ${seedCourseTitle}`);
  }

  const bookingTopic = '1:1 Project Guidance Request';
  let seedBooking = await Booking.findOne({
    student: requestedStudent._id,
    mentor: requestedTeacher._id,
    topic: bookingTopic,
  });

  if (!seedBooking) {
    seedBooking = await Booking.create({
      student: requestedStudent._id,
      mentor: requestedTeacher._id,
      topic: bookingTopic,
      dateTime: scheduledDate(4, 18),
      duration: 30,
      status: 'pending',
    });
    console.log('✅ Seed 1:1 request created for admin/teacher approval');
  } else {
    seedBooking.dateTime = scheduledDate(4, 18);
    seedBooking.duration = 30;
    if (seedBooking.status === 'cancelled') seedBooking.status = 'pending';
    await seedBooking.save();
    console.log('✅ Seed 1:1 request updated for admin/teacher approval');
  }

  seededStudents.push({
    courseTitle: seedCourseTitle,
    name: requestedStudent.name,
    username: requestedStudent.username,
    password: requestedSeedPassword,
    id: String(requestedStudent._id),
  });

  console.log('\nSuper Admin Login');
  console.log(`username: superadmin`);
  console.log(`password: superadmin123`);
  console.log(`id: ${String(superAdminId)}`);

  console.log('\nTeacher Login');
  console.log(`username: admin`);
  console.log(`password: admin123`);
  console.log(`id: ${String(teacherId)}`);

  console.log('\nRequested Teacher Login');
  console.log(`username: teacher`);
  console.log(`password: ${requestedSeedPassword}`);
  console.log(`id: ${String(requestedTeacher._id)}`);

  console.log('\nStudent Logins');
  for (const student of seededStudents) {
    console.log(`${student.courseTitle} | ${student.username} | ${student.password} | ${student.id}`);
  }

  await mongoose.disconnect();
  console.log('Done!');
}

seed().catch(console.error);
