import mongoose from 'mongoose';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { Batch } from '../models/Batch.model';
import { Course } from '../models/Course.model';
import { Curriculum } from '../models/Curriculum.model';
import { LiveClass } from '../models/LiveClass.model';
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting, ZoomApiError } from '../services/zoom.service';
import { deleteRecordedLectureForLiveClass, syncRecordedLectureForLiveClass } from '../services/recordedLectureSync.service';

const getObjectId = (value: any) => new mongoose.Types.ObjectId(value?._id || value);

const getControllerErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ZoomApiError) return error.message;
  return fallback;
};

const getControllerErrorStatus = (error: unknown) => (error instanceof ZoomApiError ? 502 : 500);

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  return fallback;
};

const stripIds = (modules: any[]) =>
  modules.map((module) => ({
    title: module.title,
    topics: (module.topics || []).map((topic: any) => ({
      title: topic.title,
      duration: topic.duration,
      scheduledAt: topic.scheduledAt,
      meetingLink: topic.meetingLink,
      liveClassId: topic.liveClassId,
      instructor: topic.instructor,
    })),
  }));

const sanitizeTemplateModules = (modules: any[]) =>
  modules.map((module: any, moduleIndex: number) => {
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

const getTemplateUsage = async (templates: any[]) => {
  if (!templates.length) return new Map<string, any[]>();

  const templateIds = templates.map((template) => template._id);
  const templateIdStrings = new Set(templateIds.map((id) => id.toString()));
  const templatesById = new Map(templates.map((template) => [template._id.toString(), template]));
  const templateTitles = templates.map((template) => template.title);
  const batchCurriculums = await Curriculum.find({
    batch: { $ne: null },
    $or: [
      { sourceTemplate: { $in: templateIds } },
      { sourceTemplate: null, title: { $in: templateTitles } },
    ],
  })
    .populate('batch', 'name isActive students startDate endDate')
    .select('title course batch sourceTemplate')
    .lean();

  const usage = new Map<string, any[]>();
  for (const curriculum of batchCurriculums as any[]) {
    const sourceId = curriculum.sourceTemplate?.toString();
    const matchingTemplate = sourceId && templateIdStrings.has(sourceId)
      ? templatesById.get(sourceId)
      : templates.find((template) => (
        template.title === curriculum.title && template.course?._id?.toString?.() === curriculum.course?.toString?.()
      ));
    const matchingTemplateId = matchingTemplate?._id?.toString();

    if (!matchingTemplateId) continue;
    const batch = curriculum.batch;
    if (!batch) continue;

    usage.set(matchingTemplateId, [
      ...(usage.get(matchingTemplateId) || []),
      {
        _id: batch._id,
        name: batch.name,
        isActive: batch.isActive,
        studentCount: batch.students?.length || 0,
        startDate: batch.startDate,
        endDate: batch.endDate,
      },
    ]);
  }

  return usage;
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
      try {
        await deleteZoomMeeting(liveClass.zoomMeetingId);
      } catch (error) {
        const message = getErrorMessage(error, 'The Zoom meeting could not be deleted.');
        console.warn(`Zoom cleanup failed for curriculum live class ${liveClass._id}: ${message}`);
      }
    }
  }

  await LiveClass.deleteMany({ _id: { $in: ids } });
  await Promise.all(ids.map((id) => deleteRecordedLectureForLiveClass(id)));
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
    sourceTemplate: template._id,
    isArchived: false,
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
      const duration = Math.max(Number(topic.duration) || 60, 1);
      const manualMeetingLink = String(topic.meetingLink || '').trim();
      const instructor = topic.instructor || null;

      if (topic.liveClassId && !topic.scheduledAt) {
        const liveClass = await LiveClass.findById(topic.liveClassId);
        if (liveClass?.zoomMeetingId) {
          await deleteZoomMeeting(liveClass.zoomMeetingId);
        }
        await liveClass?.deleteOne();
        await deleteRecordedLectureForLiveClass(String(topic.liveClassId));
        delete topic.liveClassId;
        topic.meetingLink = '';
      }

      if (topic.scheduledAt) {
        const scheduledAt = new Date(topic.scheduledAt);
        const zoomTopic = `Class ${classCounter} - ${title}`;
        const existingLiveClass = topic.liveClassId ? await LiveClass.findById(topic.liveClassId) : null;
        let meetingLink = manualMeetingLink || existingLiveClass?.meetingLink || '';
        let zoomMeetingId = existingLiveClass?.zoomMeetingId;
        let zoomMeetingUuid = existingLiveClass?.zoomMeetingUuid;
        let zoomStartUrl = existingLiveClass?.zoomStartUrl;

        if (existingLiveClass?.zoomMeetingId) {
          await updateZoomMeeting(existingLiveClass.zoomMeetingId, {
            topic: zoomTopic,
            startTime: scheduledAt,
            duration,
          });
        } else if (!manualMeetingLink) {
          const zoomMeeting = await createZoomMeeting({
            topic: zoomTopic,
            startTime: scheduledAt,
            duration,
          });
          meetingLink = zoomMeeting.join_url;
          zoomMeetingId = String(zoomMeeting.id);
          zoomMeetingUuid = zoomMeeting.uuid;
          zoomStartUrl = zoomMeeting.start_url;
        }

        const payload = {
          batch: batchId,
          classNumber: `Class ${classCounter}`,
          topic: title,
          meetingLink,
          zoomMeetingId,
          zoomMeetingUuid,
          zoomStartUrl,
          scheduledAt,
          duration,
          instructor,
          status: existingLiveClass?.status === 'live' ? 'live' : 'scheduled',
          createdBy: adminId,
        };

        if (existingLiveClass) {
          const updatedLiveClass = await LiveClass.findByIdAndUpdate(topic.liveClassId, payload, { new: true });
          if (updatedLiveClass) await syncRecordedLectureForLiveClass(updatedLiveClass);
        } else {
          const liveClass = await LiveClass.create(payload);
          await syncRecordedLectureForLiveClass(liveClass);
          topic.liveClassId = liveClass._id;
        }

        topic.meetingLink = meetingLink;
        topic.instructor = instructor || undefined;
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
    const includeArchived = _req.query.includeArchived === 'true';
    const curriculums = await Curriculum.find({ batch: null, ...(includeArchived ? {} : { isArchived: { $ne: true } }) })
      .populate('course', 'title description')
      .sort({ isArchived: 1, createdAt: 1 })
      .lean();

    const usage = await getTemplateUsage(curriculums);
    const curriculumsWithUsage = curriculums.map((curriculum: any) => ({
      ...curriculum,
      usageBatches: usage.get(curriculum._id.toString()) || [],
      usageCount: usage.get(curriculum._id.toString())?.length || 0,
    }));

    res.json({ success: true, curriculums: curriculumsWithUsage });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to load curriculums. Please try again.' });
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

    const sanitizedModules = sanitizeTemplateModules(modules);

    const curriculum = await Curriculum.create({
      title: cleanTitle,
      course,
      batch: null,
      isArchived: false,
      modules: sanitizedModules,
    });

    const populatedCurriculum = await Curriculum.findById(curriculum._id).populate('course', 'title description');
    res.status(201).json({ success: true, curriculum: populatedCurriculum });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create curriculum';
    res.status(400).json({ success: false, message });
  }
};

export const updateDefaultCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, course, modules, isArchived } = req.body;
    const cleanTitle = String(title || '').trim();

    if (!cleanTitle || !course || !Array.isArray(modules) || modules.length === 0) {
      res.status(400).json({ success: false, message: 'Title, course, and at least one module are required' });
      return;
    }

    const curriculum = await Curriculum.findOne({ _id: req.params.curriculumId, batch: null });
    if (!curriculum) {
      res.status(404).json({ success: false, message: 'Curriculum template not found' });
      return;
    }

    const courseExists = await Course.findById(course);
    if (!courseExists) {
      res.status(404).json({ success: false, message: 'Course not found' });
      return;
    }

    curriculum.title = cleanTitle;
    curriculum.course = getObjectId(course);
    curriculum.modules = sanitizeTemplateModules(modules) as any;
    if (typeof isArchived === 'boolean') curriculum.isArchived = isArchived;
    await curriculum.save();

    const populatedCurriculum = await Curriculum.findById(curriculum._id).populate('course', 'title description');
    res.json({ success: true, curriculum: populatedCurriculum });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update curriculum';
    res.status(400).json({ success: false, message });
  }
};

export const duplicateDefaultCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const template = await Curriculum.findOne({ _id: req.params.curriculumId, batch: null });
    if (!template) {
      res.status(404).json({ success: false, message: 'Curriculum template not found' });
      return;
    }

    const duplicate = await Curriculum.create({
      title: `${template.title} Copy`,
      course: template.course,
      batch: null,
      isArchived: false,
      modules: stripIds(template.modules || []),
    });

    const populatedCurriculum = await Curriculum.findById(duplicate._id).populate('course', 'title description');
    res.status(201).json({ success: true, curriculum: populatedCurriculum });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to duplicate curriculum' });
  }
};

export const archiveDefaultCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const curriculum = await Curriculum.findOneAndUpdate(
      { _id: req.params.curriculumId, batch: null },
      { isArchived: true },
      { new: true }
    ).populate('course', 'title description');

    if (!curriculum) {
      res.status(404).json({ success: false, message: 'Curriculum template not found' });
      return;
    }

    res.json({ success: true, curriculum });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to archive curriculum' });
  }
};

export const deleteDefaultCurriculum = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const template = await Curriculum.findOne({ _id: req.params.curriculumId, batch: null });
    if (!template) {
      res.status(404).json({ success: false, message: 'Curriculum template not found' });
      return;
    }

    const usageCount = await Curriculum.countDocuments({
      batch: { $ne: null },
      $or: [
        { sourceTemplate: template._id },
        { sourceTemplate: null, title: template.title, course: template.course },
      ],
    });

    if (usageCount > 0) {
      template.isArchived = true;
      await template.save();
      res.json({
        success: true,
        archived: true,
        message: 'Curriculum is used by batches, so it was archived instead of deleted.',
      });
      return;
    }

    await template.deleteOne();
    res.json({ success: true, deleted: true });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Failed to delete curriculum' });
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
    res.status(500).json({ success: false, message: 'Unable to load curriculum. Please try again.' });
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
      Curriculum.findOne({ _id: curriculumId, batch: null, isArchived: { $ne: true } }),
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
      existingBatchCurriculum.sourceTemplate = template._id as any;
      existingBatchCurriculum.isArchived = false;
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
    res.status(getControllerErrorStatus(error)).json({
      success: false,
      message: getControllerErrorMessage(error, 'Unable to assign curriculum. Please try again.'),
    });
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
        duration: Math.max(Number(topic.duration) || 60, 1),
        scheduledAt: topic.scheduledAt || undefined,
        meetingLink: topic.meetingLink ? String(topic.meetingLink).trim() : '',
        liveClassId: topic.liveClassId || undefined,
        instructor: topic.instructor || undefined,
      })),
    }));

    await syncLiveClassesForCurriculum(curriculum, sanitizedModules, req.user!.id, batchId);

    curriculum.title = String(title || curriculum.title).trim() || curriculum.title;
    curriculum.modules = sanitizedModules as any;
    await curriculum.save();

    const updatedCurriculum = await Curriculum.findById(curriculum._id).populate('course', 'title description');
    res.json({ success: true, curriculum: updatedCurriculum });
  } catch (error) {
    res.status(getControllerErrorStatus(error)).json({
      success: false,
      message: getControllerErrorMessage(error, 'Unable to save curriculum. Please try again.'),
    });
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
    res.status(500).json({ success: false, message: 'Unable to load your curriculum. Please try again.' });
  }
};
