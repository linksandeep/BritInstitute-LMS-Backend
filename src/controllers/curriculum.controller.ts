import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Batch } from '../models/Batch.model';
import { Course } from '../models/Course.model';
import { Curriculum } from '../models/Curriculum.model';
import { LiveClass } from '../models/LiveClass.model';
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting } from '../services/zoom.service';

const getObjectId = (value: any) => new mongoose.Types.ObjectId(value?._id || value);

const stripIds = (modules: any[]) =>
  modules.map((module) => ({
    title: module.title,
    topics: (module.topics || []).map((topic: any) => ({
      title: topic.title,
      duration: topic.duration,
      scheduledAt: topic.scheduledAt,
      meetingLink: topic.meetingLink,
      liveClassId: topic.liveClassId,
    })),
  }));

const getDerivedStatus = (scheduledAt: Date, duration: number) => {
  const now = Date.now();
  const start = new Date(scheduledAt).getTime();
  const end = start + duration * 60 * 1000;
  if (now < start) return 'scheduled';
  if (now > end) return 'ended';
  return 'live';
};

const getLinkedLiveClassIds = (modules: any[]) =>
  modules.flatMap((module) =>
    (module.topics || [])
      .map((topic: any) => topic.liveClassId)
      .filter(Boolean)
      .map((id: mongoose.Types.ObjectId | string) => id.toString())
  );

const deleteLinkedLiveClasses = async (ids: string[]) => {
  if (!ids.length) return;

  const liveClasses = await LiveClass.find({ _id: { $in: ids } });
  for (const liveClass of liveClasses) {
    if (liveClass.zoomMeetingId) {
      await deleteZoomMeeting(liveClass.zoomMeetingId);
    }
  }

  await LiveClass.deleteMany({ _id: { $in: ids } });
};

const cloneTemplateToBatch = async (template: any, batchId: string, batchCourse: mongoose.Types.ObjectId) => {
  const templateData = template.toObject();
  delete templateData._id;
  delete templateData.createdAt;
  delete templateData.updatedAt;

  return Curriculum.create({
    title: templateData.title,
    course: batchCourse,
    batch: new mongoose.Types.ObjectId(batchId),
    modules: stripIds(templateData.modules || []),
  });
};

const getOrCreateBatchCurriculum = async (batchId: string) => {
  let curriculum = await Curriculum.findOne({ batch: batchId }).populate('course', 'title description');
  if (curriculum) {
    return curriculum;
  }

  const batch = await Batch.findById(batchId).populate('course', 'title description');
  if (!batch) {
    return null;
  }

  const batchCourseId = getObjectId(batch.course);
  const defaultCurriculum = await Curriculum.findOne({ course: batchCourseId, batch: null }).populate('course', 'title description');
  if (!defaultCurriculum) {
    return null;
  }

  curriculum = await cloneTemplateToBatch(defaultCurriculum, batchId, batchCourseId);
  return Curriculum.findById(curriculum._id).populate('course', 'title description');
};

const syncLiveClassesForCurriculum = async (curriculum: any, modules: any[], adminId: string, batchId: string) => {
  const previousLinkedIds = getLinkedLiveClassIds(curriculum.modules || []);
  const nextLinkedIds = new Set<string>();
  let classCounter = 1;

  for (const module of modules) {
    for (const topic of module.topics || []) {
      const title = String(topic.title || '').trim();
      const duration = Number(topic.duration) || 60;

      if (topic.liveClassId && !topic.scheduledAt) {
        const liveClass = await LiveClass.findById(topic.liveClassId);
        if (liveClass?.zoomMeetingId) {
          await deleteZoomMeeting(liveClass.zoomMeetingId);
        }
        await liveClass?.deleteOne();
        delete topic.liveClassId;
        topic.meetingLink = '';
      }

      if (topic.scheduledAt) {
        const scheduledAt = new Date(topic.scheduledAt);
        const zoomTopic = `Class ${classCounter} - ${title}`;
        const existingLiveClass = topic.liveClassId ? await LiveClass.findById(topic.liveClassId) : null;
        let meetingLink = existingLiveClass?.meetingLink || String(topic.meetingLink || '').trim();
        let zoomMeetingId = existingLiveClass?.zoomMeetingId;
        let zoomStartUrl = existingLiveClass?.zoomStartUrl;

        if (existingLiveClass?.zoomMeetingId) {
          await updateZoomMeeting(existingLiveClass.zoomMeetingId, {
            topic: zoomTopic,
            startTime: scheduledAt,
            duration,
          });
        } else {
          const zoomMeeting = await createZoomMeeting({
            topic: zoomTopic,
            startTime: scheduledAt,
            duration,
          });
          meetingLink = zoomMeeting.join_url;
          zoomMeetingId = String(zoomMeeting.id);
          zoomStartUrl = zoomMeeting.start_url;
        }

        const payload = {
          batch: batchId,
          classNumber: `Class ${classCounter}`,
          topic: title,
          meetingLink,
          zoomMeetingId,
          zoomStartUrl,
          scheduledAt,
          duration,
          status: getDerivedStatus(scheduledAt, duration),
          createdBy: adminId,
        };

        if (existingLiveClass) {
          await LiveClass.findByIdAndUpdate(topic.liveClassId, payload, { new: true });
        } else {
          const liveClass = await LiveClass.create(payload);
          topic.liveClassId = liveClass._id;
        }

        topic.meetingLink = meetingLink;
        nextLinkedIds.add(topic.liveClassId.toString());
      }

      classCounter += 1;
    }
  }

  const staleIds = previousLinkedIds.filter((id) => !nextLinkedIds.has(id));
  await deleteLinkedLiveClasses(staleIds);
};

export const getDefaultCurriculums = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const curriculums = await Curriculum.find({ batch: null })
      .populate('course', 'title description')
      .sort({ createdAt: 1 });

    res.json({ success: true, curriculums });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error });
  }
};

export const createDefaultCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, course, modules } = req.body;
    const cleanTitle = String(title || '').trim();

    if (!cleanTitle || !course || !Array.isArray(modules) || modules.length === 0) {
      res.status(400).json({ success: false, message: 'Title, course, and at least one module are required' });
      return;
    }

    const courseExists = await Course.findById(course);
    if (!courseExists) {
      res.status(404).json({ success: false, message: 'Course not found' });
      return;
    }

    const sanitizedModules = modules.map((module: any, moduleIndex: number) => {
      const moduleTitle = String(module.title || '').trim();
      if (!moduleTitle) {
        throw new Error(`Module ${moduleIndex + 1} title is required`);
      }

      const topics = Array.isArray(module.topics) ? module.topics : [];
      if (topics.length === 0) {
        throw new Error(`${moduleTitle} must include at least one class/topic`);
      }

      return {
        title: moduleTitle,
        topics: topics.map((topic: any, topicIndex: number) => {
          const topicTitle = String(topic.title || '').trim();
          if (!topicTitle) {
            throw new Error(`${moduleTitle}, topic ${topicIndex + 1} title is required`);
          }

          return {
            title: topicTitle,
            duration: Math.max(Number(topic.duration) || 60, 1),
          };
        }),
      };
    });

    const curriculum = await Curriculum.create({
      title: cleanTitle,
      course,
      batch: null,
      modules: sanitizedModules,
    });

    const populatedCurriculum = await Curriculum.findById(curriculum._id).populate('course', 'title description');
    res.status(201).json({ success: true, curriculum: populatedCurriculum });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create curriculum';
    res.status(400).json({ success: false, message });
  }
};

export const getBatchCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const curriculum = await getOrCreateBatchCurriculum(req.params.batchId);
    if (!curriculum) {
      res.status(404).json({ success: false, message: 'No curriculum found for this batch' });
      return;
    }

    res.json({ success: true, curriculum });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error });
  }
};

export const assignCurriculumToBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;
    const { curriculumId } = req.body;

    if (!curriculumId) {
      res.status(400).json({ success: false, message: 'curriculumId is required' });
      return;
    }

    const [batch, template, existingBatchCurriculum] = await Promise.all([
      Batch.findById(batchId),
      Curriculum.findOne({ _id: curriculumId, batch: null }),
      Curriculum.findOne({ batch: batchId }),
    ]);

    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    if (!template) {
      res.status(404).json({ success: false, message: 'Curriculum template not found' });
      return;
    }

    if (existingBatchCurriculum) {
      const linkedIds = getLinkedLiveClassIds(existingBatchCurriculum.modules || []);
      await deleteLinkedLiveClasses(linkedIds);

      existingBatchCurriculum.title = template.title;
      existingBatchCurriculum.course = getObjectId(batch.course);
      existingBatchCurriculum.modules = stripIds(template.modules || []) as any;
      await existingBatchCurriculum.save();

      const updatedCurriculum = await Curriculum.findById(existingBatchCurriculum._id).populate('course', 'title description');
      res.json({ success: true, message: 'Batch curriculum replaced. A batch can have only one curriculum at a time.', curriculum: updatedCurriculum });
      return;
    }

    const newCurriculum = await cloneTemplateToBatch(template, batchId, getObjectId(batch.course));
    const populatedCurriculum = await Curriculum.findById(newCurriculum._id).populate('course', 'title description');
    res.json({ success: true, message: 'Curriculum assigned to batch. Each batch supports exactly one curriculum.', curriculum: populatedCurriculum });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error });
  }
};

export const updateBatchCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { batchId } = req.params;
    const { title, modules } = req.body;

    if (!Array.isArray(modules)) {
      res.status(400).json({ success: false, message: 'modules must be an array' });
      return;
    }

    const curriculum = await getOrCreateBatchCurriculum(batchId);
    if (!curriculum) {
      res.status(404).json({ success: false, message: 'Batch curriculum not found' });
      return;
    }

    const sanitizedModules = modules.map((module: any) => ({
      title: String(module.title || '').trim(),
      topics: (module.topics || []).map((topic: any) => ({
        _id: topic._id,
        title: String(topic.title || '').trim(),
        duration: Number(topic.duration) || 60,
        scheduledAt: topic.scheduledAt || undefined,
        meetingLink: topic.meetingLink ? String(topic.meetingLink).trim() : '',
        liveClassId: topic.liveClassId || undefined,
      })),
    }));

    await syncLiveClassesForCurriculum(curriculum, sanitizedModules, req.user!.id, batchId);

    curriculum.title = String(title || curriculum.title).trim() || curriculum.title;
    curriculum.modules = sanitizedModules as any;
    await curriculum.save();

    const updatedCurriculum = await Curriculum.findById(curriculum._id).populate('course', 'title description');
    res.json({ success: true, curriculum: updatedCurriculum });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error });
  }
};

export const getMyCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const activeBatch = await Batch.findOne({ students: req.user!.id, isActive: true }).sort({ startDate: -1 });
    if (!activeBatch) {
      res.status(404).json({ success: false, message: 'No active batch found for student' });
      return;
    }

    const curriculum = await getOrCreateBatchCurriculum(activeBatch._id.toString());
    if (!curriculum) {
      res.status(404).json({ success: false, message: 'No curriculum available for your batch' });
      return;
    }

    res.json({ success: true, curriculum, batch: activeBatch });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error });
  }
};
