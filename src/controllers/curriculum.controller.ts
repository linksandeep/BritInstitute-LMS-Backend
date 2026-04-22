import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Batch } from '../models/Batch.model';
import { Curriculum } from '../models/Curriculum.model';
import { LiveClass } from '../models/LiveClass.model';

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
      const meetingLink = String(topic.meetingLink || '').trim();
      const duration = Number(topic.duration) || 60;

      if (topic.liveClassId && !topic.scheduledAt) {
        await LiveClass.findByIdAndDelete(topic.liveClassId);
        delete topic.liveClassId;
      }

      if (topic.scheduledAt) {
        const scheduledAt = new Date(topic.scheduledAt);
        const payload = {
          batch: batchId,
          classNumber: `Class ${classCounter}`,
          topic: title,
          meetingLink,
          scheduledAt,
          duration,
          status: getDerivedStatus(scheduledAt, duration),
          createdBy: adminId,
        };

        if (topic.liveClassId) {
          await LiveClass.findByIdAndUpdate(topic.liveClassId, payload, { new: true });
        } else {
          const liveClass = await LiveClass.create(payload);
          topic.liveClassId = liveClass._id;
        }

        nextLinkedIds.add(topic.liveClassId.toString());
      }

      classCounter += 1;
    }
  }

  const staleIds = previousLinkedIds.filter((id) => !nextLinkedIds.has(id));
  if (staleIds.length) {
    await LiveClass.deleteMany({ _id: { $in: staleIds } });
  }
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
      if (linkedIds.length) {
        await LiveClass.deleteMany({ _id: { $in: linkedIds } });
      }

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
