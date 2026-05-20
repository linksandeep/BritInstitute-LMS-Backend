import { ILiveClass } from '../models/LiveClass.model';
import { RecordedLecture } from '../models/RecordedLecture.model';
import { LiveClass } from '../models/LiveClass.model';
import {
  getZoomMeetingRecordings,
  ZoomApiError,
  ZoomRecordingFile,
  ZoomRecordingsResponse,
} from './zoom.service';

const recordingPriority = (file: ZoomRecordingFile): number => {
  const type = String(file.recording_type || '').toLowerCase();
  const extension = String(file.file_extension || file.file_type || '').toLowerCase();

  if (extension === 'mp4' && type.includes('shared_screen_with_speaker_view')) return 0;
  if (extension === 'mp4' && type.includes('shared_screen')) return 1;
  if (extension === 'mp4' && type.includes('active_speaker')) return 2;
  if (extension === 'mp4' && type.includes('gallery_view')) return 3;
  if (extension === 'mp4') return 4;
  return 10;
};

const pickBestRecordingFile = (recording: ZoomRecordingsResponse): ZoomRecordingFile | null => {
  const files = (recording.recording_files || [])
    .filter((file) => {
      const status = String(file.status || 'completed').toLowerCase();
      const extension = String(file.file_extension || file.file_type || '').toLowerCase();
      return status === 'completed' && extension === 'mp4' && Boolean(file.download_url || file.play_url);
    })
    .sort((a, b) => recordingPriority(a) - recordingPriority(b));

  return files[0] || null;
};

export const syncRecordedLectureForLiveClass = async (liveClass: ILiveClass): Promise<void> => {
  const title = `${liveClass.classNumber} - ${liveClass.topic}`;
  const existing = await RecordedLecture.findOne({ liveClass: liveClass._id });

  if (existing?.recordingSource === 'zoom' && existing.recordingStatus === 'available') {
    existing.batch = liveClass.batch;
    existing.title = title;
    existing.order = new Date(liveClass.scheduledAt).getTime();
    existing.uploadedBy = liveClass.createdBy;
    await existing.save();
    return;
  }

  await RecordedLecture.findOneAndUpdate(
    { liveClass: liveClass._id },
    {
      batch: liveClass.batch,
      liveClass: liveClass._id,
      title,
      description: 'Zoom recording will be attached automatically after the session is completed and Zoom finishes processing.',
      videoUrl: liveClass.meetingLink,
      videoType: 'zoom',
      recordingSource: 'zoom',
      recordingStatus: 'pending',
      order: new Date(liveClass.scheduledAt).getTime(),
      uploadedBy: liveClass.createdBy,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const syncZoomRecordingForLiveClass = async (
  liveClass: ILiveClass,
  recordingPayload?: ZoomRecordingsResponse
): Promise<boolean> => {
  const recording = recordingPayload || await getZoomMeetingRecordings(liveClass.zoomMeetingId || '');
  const bestFile = pickBestRecordingFile(recording);

  if (!bestFile) {
    await syncRecordedLectureForLiveClass(liveClass);
    return false;
  }

  const title = `${liveClass.classNumber} - ${liveClass.topic}`;
  await RecordedLecture.findOneAndUpdate(
    { liveClass: liveClass._id },
    {
      batch: liveClass.batch,
      liveClass: liveClass._id,
      title,
      description: 'Zoom cloud recording imported automatically for this scheduled live class.',
      videoUrl: bestFile.play_url || bestFile.download_url || recording.share_url || liveClass.meetingLink,
      videoType: 'zoom',
      recordingSource: 'zoom',
      recordingStatus: 'available',
      zoomRecordingFileId: bestFile.id,
      zoomRecordingMeetingId: String(recording.id || liveClass.zoomMeetingId || ''),
      zoomDownloadUrl: bestFile.download_url,
      zoomPlayUrl: bestFile.play_url,
      zoomShareUrl: recording.share_url,
      recordingStartedAt: bestFile.recording_start ? new Date(bestFile.recording_start) : undefined,
      recordingCompletedAt: bestFile.recording_end ? new Date(bestFile.recording_end) : new Date(),
      order: new Date(liveClass.scheduledAt).getTime(),
      uploadedBy: liveClass.createdBy,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return true;
};

export const syncPendingZoomRecordings = async (): Promise<{ checked: number; imported: number }> => {
  const pendingLectures = await RecordedLecture.find({
    liveClass: { $exists: true },
    $or: [
      { recordingSource: 'zoom', recordingStatus: 'pending' },
      { recordingStatus: { $exists: false } },
    ],
  }).select('liveClass');
  const liveClassIds = pendingLectures.map((lecture) => lecture.liveClass).filter(Boolean);
  if (liveClassIds.length === 0) return { checked: 0, imported: 0 };

  const liveClasses = await LiveClass.find({
    _id: { $in: liveClassIds },
    zoomMeetingId: { $exists: true, $ne: '' },
    status: 'ended',
  });

  let imported = 0;
  for (const liveClass of liveClasses) {
    try {
      const didImport = await syncZoomRecordingForLiveClass(liveClass);
      if (didImport) imported += 1;
    } catch (err) {
      if (err instanceof ZoomApiError && [404, 429].includes(err.status)) {
        console.warn(`Zoom recording sync skipped for live class ${liveClass._id}: ${err.message}`);
        continue;
      }
      console.warn(`Zoom recording sync failed for live class ${liveClass._id}:`, err);
    }
  }

  return { checked: liveClasses.length, imported };
};

export const deleteRecordedLectureForLiveClass = async (liveClassId: string): Promise<void> => {
  await RecordedLecture.deleteOne({ liveClass: liveClassId });
};
