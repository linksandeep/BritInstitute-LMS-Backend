import { ILiveClass } from '../models/LiveClass.model';
import { RecordedLecture } from '../models/RecordedLecture.model';

export const syncRecordedLectureForLiveClass = async (liveClass: ILiveClass): Promise<void> => {
  const title = `${liveClass.classNumber} - ${liveClass.topic}`;

  await RecordedLecture.findOneAndUpdate(
    { liveClass: liveClass._id },
    {
      batch: liveClass.batch,
      liveClass: liveClass._id,
      title,
      description: 'Auto-created from the scheduled Zoom class. Replace the URL with the Zoom recording link after the session is completed.',
      videoUrl: liveClass.meetingLink,
      videoType: 'other',
      order: new Date(liveClass.scheduledAt).getTime(),
      uploadedBy: liveClass.createdBy,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const deleteRecordedLectureForLiveClass = async (liveClassId: string): Promise<void> => {
  await RecordedLecture.deleteOne({ liveClass: liveClassId });
};
