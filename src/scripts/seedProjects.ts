import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Batch } from '../models/Batch.model';
import { Project, ProjectResourceType } from '../models/Project.model';
import { User } from '../models/User.model';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/britInstiuteLMS';

interface ProjectSeedDef {
  name: string;
  description: string;
  skills: string[];
  resourceType: ProjectResourceType;
  resourceUrl: string;
}

const projectsToUpload: ProjectSeedDef[] = [
  // Excel Projects
  {
    name: 'Enhanced Operation KPI Tracker',
    description: 'Operational performance and KPI tracking dashboard in Excel. Includes automated metrics calculation, target variance tracking, dynamic charts, and executive reporting.',
    skills: ['Excel', 'KPI Dashboard', 'Operations Analytics', 'Power Query'],
    resourceType: 'drive',
    resourceUrl: 'https://drive.google.com/drive/folders/167Q_WT9MgBEHY7lZVOsHTZsICWd7oLRE?usp=sharing',
  },
  {
    name: 'HR analytics with Excel',
    description: 'Comprehensive HR analytics project in Excel. Covers employee attrition analysis, headcount distribution, performance metrics, and interactive summary dashboards.',
    skills: ['Excel', 'HR Analytics', 'Data Visualization', 'Pivot Tables'],
    resourceType: 'drive',
    resourceUrl: 'https://drive.google.com/drive/folders/1UHbMBWVavj8QutomibAJ2Utqexvr5MFp?usp=sharing',
  },

  // PowerBI projects
  {
    name: 'EU_Healthcare_Operations_Claims',
    description: 'Power BI business intelligence dashboard analyzing European healthcare claims operations, approval ratios, processing durations, and operational cost drivers.',
    skills: ['Power BI', 'DAX', 'Healthcare Analytics', 'Data Modeling'],
    resourceType: 'drive',
    resourceUrl: 'https://drive.google.com/drive/folders/1ppFHIzIsgpUPSf_uH8F4ZRc00xC7KEk-?usp=sharing',
  },
  {
    name: 'EU_Pharma_Sales',
    description: 'Pharmaceutical sales dashboard in Power BI tracking regional sales trends, product segment performance, revenue targets, and customer distributions across European markets.',
    skills: ['Power BI', 'DAX', 'Sales Analytics', 'Business Intelligence'],
    resourceType: 'drive',
    resourceUrl: 'https://drive.google.com/drive/folders/1Il54M9Cq34hVczJlVLaW7Kh9azJB_2yp?usp=sharing',
  },

  // SQL projects
  {
    name: 'Finance Project',
    description: 'Practical SQL finance project evaluating transaction records, customer account balances, cash flow metrics, and revenue reporting using complex queries and aggregations.',
    skills: ['SQL', 'Financial Analytics', 'Relational Databases', 'Data Querying'],
    resourceType: 'drive',
    resourceUrl: 'https://drive.google.com/drive/folders/1XsYE0KYJkcFaXIz4Ohwbku7A5fj_RSsD?usp=sharing',
  },
  {
    name: 'Healthcare SQL',
    description: 'Relational database analysis project analyzing hospital patient admissions, treatment pathways, diagnosis records, and length-of-stay metrics using SQL.',
    skills: ['SQL', 'Healthcare Analytics', 'Database Management', 'Data Aggregation'],
    resourceType: 'drive',
    resourceUrl: 'https://drive.google.com/drive/folders/1wFHjOsmPA0_1D8xBRk3BqpQqCiuZ3AyP?usp=sharing',
  },

  // Python projects
  {
    name: 'Retail Data Cleaning',
    description: 'Hands-on Python and Pandas data cleaning project focusing on real-world retail transactions, handling missing data, type casting, duplicate removal, and outlier detection.',
    skills: ['Python', 'Pandas', 'Data Cleaning', 'Data Preprocessing'],
    resourceType: 'drive',
    resourceUrl: 'https://drive.google.com/drive/folders/1a2UDmHGbWBixU5FL0zT4_PfmFdvndm1E?usp=sharing',
  },
];

async function seedProjects() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    // Find admin user for uploadedBy field
    let adminUser = await User.findOne({ role: 'superadmin' });
    if (!adminUser) {
      adminUser = await User.findOne({ role: { $in: ['admin', 'teacher'] } });
    }
    if (!adminUser) {
      throw new Error('No admin or teacher user found to assign uploadedBy');
    }
    console.log(`Using uploader: ${adminUser.name} (${adminUser._id})`);

    // Fetch all active batches
    const batches = await Batch.find({ isActive: true });
    console.log(`Found ${batches.length} active batches:`);
    batches.forEach(b => console.log(` - [${b._id}] ${b.name}`));

    let totalCreated = 0;
    let totalUpdated = 0;

    for (const batch of batches) {
      console.log(`\nProcessing batch: "${batch.name}" (${batch._id})`);

      for (const projectData of projectsToUpload) {
        const existingProject = await Project.findOne({
          batch: batch._id,
          name: projectData.name,
        });

        if (existingProject) {
          existingProject.description = projectData.description;
          existingProject.skills = projectData.skills;
          existingProject.resourceType = projectData.resourceType;
          existingProject.resourceUrl = projectData.resourceUrl;
          existingProject.uploadedBy = adminUser._id as mongoose.Types.ObjectId;
          await existingProject.save();
          console.log(`  [UPDATED] ${projectData.name}`);
          totalUpdated++;
        } else {
          await Project.create({
            batch: batch._id,
            name: projectData.name,
            description: projectData.description,
            skills: projectData.skills,
            resourceType: projectData.resourceType,
            resourceUrl: projectData.resourceUrl,
            uploadedBy: adminUser._id,
          });
          console.log(`  [CREATED] ${projectData.name}`);
          totalCreated++;
        }
      }
    }

    console.log('\n========================================');
    console.log(`Seeding complete! Created: ${totalCreated}, Updated: ${totalUpdated}`);
    console.log('========================================');

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
}

seedProjects();
