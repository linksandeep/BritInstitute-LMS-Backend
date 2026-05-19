import mongoose from 'mongoose';
import { config } from './env';
import { User } from '../models/User.model';

const ensureUserEmailIndex = async (): Promise<void> => {
  const indexes = await User.collection.indexes();
  const emailIndex = indexes.find((index) => index.name === 'email_1');

  if (emailIndex && (emailIndex.unique || !emailIndex.partialFilterExpression)) {
    await User.collection.dropIndex('email_1');
  }

  const refreshedIndexes = await User.collection.indexes();
  const hasNonEmptyEmailIndex = refreshedIndexes.some((index) => index.name === 'email_unique_non_empty');
  if (!hasNonEmptyEmailIndex) {
    await User.collection.createIndex(
      { email: 1 },
      {
        name: 'email_unique_non_empty',
        unique: true,
        partialFilterExpression: { email: { $type: 'string', $gt: '' } },
      }
    );
  }
};

export const connectDB = async (): Promise<void> => {
  const conn = await mongoose.connect(config.mongoUri);
  await ensureUserEmailIndex();
  console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
};
