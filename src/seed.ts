import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Course } from './models/Course.model';
import { Curriculum } from './models/Curriculum.model';
import { User } from './models/User.model';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/britInstiuteLMS';
const SEED_PASSWORD = 'Pass@123';

const curriculumSeeds = [
  {
    title: 'Data Analytics with Generative AI',
    description: 'A practical curriculum covering analytics foundations, reporting, automation, and Generative AI workflows.',
    modules: [
      {
        title: 'Module 1: Analytics Foundations',
        topics: [
          { title: 'Excel for Data Analysis', duration: 90 },
          { title: 'SQL Fundamentals', duration: 90 },
          { title: 'Python for Data Analysis', duration: 120 },
        ],
      },
      {
        title: 'Module 2: Dashboards and Reporting',
        topics: [
          { title: 'Power BI Fundamentals', duration: 120 },
          { title: 'Dashboard Design', duration: 90 },
          { title: 'Data Storytelling', duration: 90 },
        ],
      },
      {
        title: 'Module 3: Generative AI for Analysts',
        topics: [
          { title: 'Prompting for Analysis', duration: 90 },
          { title: 'Automating Reports with AI', duration: 120 },
          { title: 'Analytics Capstone', duration: 120 },
        ],
      },
    ],
  },
  {
    title: 'Full Stack Web Development',
    description: 'A full stack curriculum focused on modern frontend, backend APIs, databases, and deployment.',
    modules: [
      {
        title: 'Module 1: Frontend Essentials',
        topics: [
          { title: 'HTML, CSS, and Responsive UI', duration: 90 },
          { title: 'JavaScript Fundamentals', duration: 120 },
          { title: 'React Components and State', duration: 120 },
        ],
      },
      {
        title: 'Module 2: Backend and Database',
        topics: [
          { title: 'Node.js and Express APIs', duration: 120 },
          { title: 'MongoDB Data Modeling', duration: 90 },
          { title: 'Authentication and Authorization', duration: 90 },
        ],
      },
      {
        title: 'Module 3: Production Project',
        topics: [
          { title: 'API Integration', duration: 90 },
          { title: 'Deployment Workflow', duration: 90 },
          { title: 'Final Full Stack Project', duration: 120 },
        ],
      },
    ],
  },
  {
    title: 'Agentic AI',
    description: 'A compact curriculum for AI agents, tool use, orchestration, evaluation, and deployment patterns.',
    modules: [
      {
        title: 'Module 1: Agent Foundations',
        topics: [
          { title: 'Agent Architectures', duration: 90 },
          { title: 'Planning and Tool Use', duration: 90 },
          { title: 'Memory and State', duration: 90 },
        ],
      },
      {
        title: 'Module 2: Building Useful Agents',
        topics: [
          { title: 'Function Calling', duration: 120 },
          { title: 'Workflow Automation', duration: 90 },
          { title: 'Multi-Step Agent Design', duration: 120 },
        ],
      },
      {
        title: 'Module 3: Evaluation and Launch',
        topics: [
          { title: 'Agent Evaluation', duration: 90 },
          { title: 'Safety and Guardrails', duration: 90 },
          { title: 'Production Agent Project', duration: 120 },
        ],
      },
    ],
  },
];

const clearDatabase = async () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');

  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
};

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  await clearDatabase();
  console.log('Cleared existing database data');

  const superAdmin = await User.create({
    name: 'Super Admin',
    username: 'superadmin',
    password: SEED_PASSWORD,
    role: 'superadmin',
    isActive: true,
  });

  const courses = [];
  for (const curriculum of curriculumSeeds) {
    const course = await Course.create({
      title: curriculum.title,
      description: curriculum.description,
      createdBy: superAdmin._id,
      isPublic: true,
      assignedTeachers: [],
    });

    await Curriculum.create({
      title: curriculum.title,
      course: course._id,
      batch: null,
      modules: curriculum.modules,
    });

    courses.push(course);
  }

  const students = [
    { name: 'Vikas', username: 'vikas', enrolledCourse: courses[0]._id },
    { name: 'Sandeep', username: 'sandeep', enrolledCourse: courses[1]._id },
    { name: 'Ravi', username: 'ravi', enrolledCourse: courses[2]._id },
  ];

  for (const student of students) {
    await User.create({
      ...student,
      password: SEED_PASSWORD,
      role: 'student',
      isActive: true,
    });
  }

  console.log('\nSeeded accounts');
  console.log(`Super Admin | username: superadmin | password: ${SEED_PASSWORD}`);
  for (const student of students) {
    console.log(`Student | username: ${student.username} | password: ${SEED_PASSWORD}`);
  }

  console.log('\nSeeded curriculum records');
  for (const course of courses) {
    console.log(`Curriculum | ${course.title}`);
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
