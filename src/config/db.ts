import mongoose from 'mongoose';
import { config } from './env';

export const connectDB = async (): Promise<void> => {
  const conn = await mongoose.connect(config.mongoUri);
  console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
};
