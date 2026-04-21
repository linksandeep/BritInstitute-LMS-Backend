import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/britInstiuteLMS';

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;

  // Clear existing data
  await db.collection('users').deleteMany({});
  console.log('Cleared users');

  // Create admin
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await db.collection('users').insertOne({
    name: 'Administrator',
    username: 'admin',
    password: hashedPassword,
    role: 'admin',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log('✅ Admin created — username: admin | password: admin123');
  await mongoose.disconnect();
  console.log('Done!');
}

seed().catch(console.error);
