import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Batch } from '../models/Batch.model';
import { Project } from '../models/Project.model';
import { User } from '../models/User.model';
import { capstoneProjects } from '../data/capstoneProjects';
import { isValidProjectResourceUrl } from '../utils/projectResource';

dotenv.config();

async function seedCapstoneProjects(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const batchIdIndex = process.argv.indexOf('--batch-id');
  const batchId = batchIdIndex >= 0 ? process.argv[batchIdIndex + 1] : undefined;
  if (batchIdIndex >= 0 && (!batchId || !mongoose.isValidObjectId(batchId))) {
    throw new Error('--batch-id requires a valid batch ID');
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  for (const project of capstoneProjects) {
    if (!isValidProjectResourceUrl(project.resourceType, project.resourceUrl)) {
      throw new Error(`Invalid repository URL for ${project.name}`);
    }
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  try {
    // Match the requested batch only; never seed every active batch.
    const batches = await Batch.find(batchId
      ? { _id: batchId, isActive: true }
      : { name: /^projects?\s*(?:&|and)\s*placement$/i, isActive: true });
    if (batches.length !== 1) {
      throw new Error(`Expected one active Projects & placement batch, found ${batches.length}. Specify --batch-id to select it.`);
    }
    const batch = batches[0];
    let uploader = await User.findOne({ role: 'superadmin', isActive: true });
    if (!uploader) uploader = await User.findOne({ role: 'admin', isActive: true });
    if (!uploader) throw new Error('No active admin or superadmin found for uploadedBy');

    console.log(`${apply ? 'Applying' : 'Dry run'}: ${batch.name} (${batch._id})`);
    let created = 0;
    let skipped = 0;
    for (const definition of capstoneProjects) {
      const existing = await Project.findOne({
        batch: batch._id,
        $or: [{ resourceUrl: definition.resourceUrl }, { name: definition.name }],
      });
      if (existing) {
        if (existing.resourceType !== 'github' || existing.resourceUrl !== definition.resourceUrl) {
          throw new Error(`Conflicting existing project: ${definition.name}. Review before importing.`);
        }
        console.log(`[EXISTS] ${definition.name}`);
        skipped++;
        continue;
      }
      if (apply) {
        await Project.create({ ...definition, batch: batch._id, uploadedBy: uploader._id });
        created++;
      }
      console.log(`[${apply ? 'CREATED' : 'WOULD CREATE'}] ${definition.name}`);
    }
    console.log(`Created: ${created}; already present: ${skipped}`);
    if (!apply) console.log('Run with --apply to add the missing projects.');
  } finally {
    await mongoose.disconnect();
  }
}

seedCapstoneProjects().catch(() => {
  // Connection errors may include credentials; do not print the configured URI.
  console.error('Capstone import failed. Check database access, the target batch and existing project conflicts.');
  process.exitCode = 1;
});
