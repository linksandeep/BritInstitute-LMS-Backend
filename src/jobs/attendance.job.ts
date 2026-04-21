import cron from 'node-cron';
import { LiveClass } from '../models/LiveClass.model';
import { autoMarkAbsent } from '../controllers/liveClass.controller';

export const startAttendanceJob = (): void => {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();

      // Find all scheduled classes that have passed their end time
      const endedClasses = await LiveClass.find({ status: 'scheduled' });

      for (const cls of endedClasses) {
        const endTime = new Date(cls.scheduledAt.getTime() + cls.duration * 60 * 1000);
        if (now > endTime) {
          await autoMarkAbsent(String(cls._id));
        }
      }
    } catch (err) {
      console.error('❌ Attendance cron error:', err);
    }
  });

  console.log('⏰ Attendance auto-mark job started (every 5 minutes)');
};
