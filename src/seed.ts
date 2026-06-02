import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Course } from './models/Course.model';
import { Curriculum } from './models/Curriculum.model';
import { User } from './models/User.model';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/britInstiuteLMS';

const PROGRAM_TITLE = 'Data Analyst and Applied GenAI Certification Program';
const PROGRAM_DESCRIPTION =
  'A 6-month weekend certification program with 26 weeks, 52 Saturday/Sunday classes, and 104 guided learning hours. Students progress from Excel, Power BI, SQL, Python, AI-assisted analytics, statistics, and machine learning into a job-ready portfolio.';

const classTopic = (classNumber: number, week: number, day: 'Saturday' | 'Sunday', title: string) => ({
  title: `Class ${classNumber} (Week ${week} - ${day}): ${title}`,
  duration: 120,
});

const curriculumSeed = {
  title: PROGRAM_TITLE,
  description: PROGRAM_DESCRIPTION,
  modules: [
    {
      title: 'Module 1: Excel for Data Analysis',
      topics: [
        classTopic(1, 1, 'Saturday', 'Program Kickoff & Data Analyst Role in the UK'),
        classTopic(2, 1, 'Sunday', 'Excel Data Types, Cleaning & Validation'),
        classTopic(3, 2, 'Saturday', 'Excel Formulas: IF, IFS, SUMIFS, COUNTIFS'),
        classTopic(4, 2, 'Sunday', 'XLOOKUP, Text Functions & AI-Assisted Formula Documentation'),
        classTopic(5, 3, 'Saturday', 'Pivot Tables, Pivot Charts & Dashboard Design'),
        classTopic(6, 3, 'Sunday', 'Power Query & Operations KPI Tracker Project Submission'),
      ],
    },
    {
      title: 'Module 2: Power BI & Data Visualization',
      topics: [
        classTopic(1, 4, 'Saturday', 'Power BI Introduction & Data Connections'),
        classTopic(2, 4, 'Sunday', 'Power Query Transformations'),
        classTopic(3, 5, 'Saturday', 'Data Modeling Fundamentals'),
        classTopic(4, 5, 'Sunday', 'DAX Fundamentals'),
        classTopic(5, 6, 'Saturday', 'Business KPI Measures'),
        classTopic(6, 6, 'Sunday', 'Visualization Best Practices'),
        classTopic(7, 7, 'Saturday', 'Storytelling with Dashboards'),
        classTopic(8, 7, 'Sunday', 'Publishing & Row-Level Security'),
        classTopic(9, 8, 'Saturday', 'Power BI Project Build Lab'),
        classTopic(10, 8, 'Sunday', 'Executive BI Dashboard Presentation'),
      ],
    },
    {
      title: 'Module 3: SQL & Advanced SQL',
      topics: [
        classTopic(1, 9, 'Saturday', 'SQL Fundamentals'),
        classTopic(2, 9, 'Sunday', 'GROUP BY, HAVING & Aggregations'),
        classTopic(3, 10, 'Saturday', 'Joins & Business Data Relationships'),
        classTopic(4, 10, 'Sunday', 'Subqueries & Set Operations'),
        classTopic(5, 11, 'Saturday', 'CTEs & Readable SQL'),
        classTopic(6, 11, 'Sunday', 'Window Functions'),
        classTopic(7, 12, 'Saturday', 'String & Date Functions'),
        classTopic(8, 12, 'Sunday', 'Query Optimization & Indexes'),
        classTopic(9, 13, 'Saturday', 'AI-Assisted SQL Development'),
        classTopic(10, 13, 'Sunday', 'SQL Business Case Pack Submission'),
      ],
    },
    {
      title: 'Module 4: Python for Data Analytics & AI',
      topics: [
        classTopic(1, 14, 'Saturday', 'Python Fundamentals: Syntax, Variables, and Control Flow'),
        classTopic(2, 14, 'Sunday', 'Python Practice Lab: Functions, Files, and Notebooks'),
        classTopic(3, 15, 'Saturday', 'Pandas & Data Cleaning'),
        classTopic(4, 15, 'Sunday', 'Pandas Lab: Missing Values, Joins, and Data Quality Checks'),
        classTopic(5, 16, 'Saturday', 'Exploratory Data Analysis & Visualization'),
        classTopic(6, 16, 'Sunday', 'EDA Lab: Charts, Insights, and Analyst Commentary'),
        classTopic(7, 17, 'Saturday', 'Automation & APIs for Analysts'),
        classTopic(8, 17, 'Sunday', 'API Data Pipeline Lab'),
        classTopic(9, 18, 'Saturday', 'GenAI Foundations for Analysts'),
        classTopic(10, 18, 'Sunday', 'Prompting Lab: AI-Assisted Data Cleaning and Insight Drafting'),
        classTopic(11, 19, 'Saturday', 'Function Calling & Embeddings'),
        classTopic(12, 19, 'Sunday', 'AI Workflow Lab: Retrieval and Structured Outputs'),
        classTopic(13, 20, 'Saturday', 'Analyst Copilot Build'),
        classTopic(14, 20, 'Sunday', 'Analyst Copilot Mini-App Demo'),
      ],
    },
    {
      title: 'Module 5: Statistics & Business Decision Making',
      topics: [
        classTopic(1, 21, 'Saturday', 'Descriptive Statistics'),
        classTopic(2, 21, 'Sunday', 'Probability & Sampling'),
        classTopic(3, 22, 'Saturday', 'Hypothesis Testing'),
        classTopic(4, 22, 'Sunday', 'Correlation, Regression & Decision Memo Submission'),
      ],
    },
    {
      title: 'Module 6: Machine Learning Fundamentals',
      topics: [
        classTopic(1, 23, 'Saturday', 'ML Workflow & Problem Framing'),
        classTopic(2, 23, 'Sunday', 'Preprocessing & Pipelines'),
        classTopic(3, 24, 'Saturday', 'Regression Models'),
        classTopic(4, 24, 'Sunday', 'Classification Models'),
        classTopic(5, 25, 'Saturday', 'Clustering & Segmentation'),
        classTopic(6, 25, 'Sunday', 'Explainability & Bias'),
        classTopic(7, 26, 'Saturday', 'Final ML Build Lab'),
        classTopic(8, 26, 'Sunday', 'Portfolio Presentation & Interview Defense'),
      ],
    },
  ],
};

const curriculumTemplateTitlesToReplace = [
  PROGRAM_TITLE,
  'Data Analytics with Generative AI',
  'Full Stack Web Development',
  'Agentic AI',
];

const getCourseOwnerId = async () => {
  const existingOwner = await User.findOne({ role: { $in: ['superadmin', 'admin'] } }).sort({ createdAt: 1 });
  return existingOwner?._id || new mongoose.Types.ObjectId(process.env.SEED_CREATED_BY_ID);
};

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const ownerId = await getCourseOwnerId();
  const course = await Course.findOneAndUpdate(
    { title: PROGRAM_TITLE },
    {
      title: PROGRAM_TITLE,
      description: PROGRAM_DESCRIPTION,
      createdBy: ownerId,
      isPublic: true,
      assignedTeachers: [],
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await Curriculum.deleteMany({
    batch: null,
    title: { $in: curriculumTemplateTitlesToReplace, $ne: PROGRAM_TITLE },
  });

  const curriculum = await Curriculum.findOneAndUpdate(
    { title: PROGRAM_TITLE, batch: null },
    {
      title: PROGRAM_TITLE,
      course: course._id,
      batch: null,
      sourceTemplate: null,
      isArchived: false,
      modules: curriculumSeed.modules,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const totalClasses = curriculum.modules.reduce((sum, module) => sum + module.topics.length, 0);
  const totalMinutes = curriculum.modules.reduce(
    (sum, module) => sum + module.topics.reduce((moduleSum, topic) => moduleSum + topic.duration, 0),
    0
  );

  console.log('\nSeeded curriculum template');
  console.log(`Course | ${course.title}`);
  console.log(`Curriculum | ${curriculum.title}`);
  console.log(`Modules | ${curriculum.modules.length}`);
  console.log(`Classes | ${totalClasses}`);
  console.log(`Guided learning hours | ${totalMinutes / 60}`);
  console.log('\nNo users, batches, attendance, assignments, or activity records were cleared.');

  await mongoose.disconnect();
  console.log('\nDone!');
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
