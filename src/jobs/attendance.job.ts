import cron from 'node-cron';
import { LiveClass } from '../models/LiveClass.model';
import { autoMarkAbsent } from '../controllers/liveClass.controller';
import { syncPendingZoomRecordings } from '../services/recordedLectureSync.service';

export const startAttendanceJob = (): void => {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      const expiredScheduledClasses = await LiveClass.find({ status: 'scheduled' });

      for (const cls of expiredScheduledClasses) {
        const endTime = new Date(cls.scheduledAt.getTime() + cls.duration * 60 * 1000);
        if (now > endTime) {
          await autoMarkAbsent(String(cls._id));
        }
      }

      const zoomSync = await syncPendingZoomRecordings();
      if (zoomSync.checked > 0) {
        console.log(`🎬 Zoom recording sync checked ${zoomSync.checked}, imported ${zoomSync.imported}`);
      }
    } catch (err) {
      console.error('❌ Attendance cron error:', err);
    }
  });

  console.log('⏰ Live class background job started (every 5 minutes)');
};
