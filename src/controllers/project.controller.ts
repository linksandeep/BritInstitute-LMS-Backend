import { Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth.middleware';
import { projectUploadDir } from '../middleware/projectUpload.middleware';
import { Batch } from '../models/Batch.model';
import { Project, ProjectResourceType } from '../models/Project.model';
import { isValidProjectResourceUrl } from '../utils/projectResource';

const cleanString = (value: unknown) => String(value || '').trim();

const parseSkills = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : cleanString(value).split(',');
  return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, 20);
};

const removeUploadedFile = async (fileName?: string): Promise<void> => {
  if (!fileName) return;
  const safeFileName = path.basename(fileName);
  try {
    await fs.unlink(path.join(projectUploadDir, safeFileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

const removeRequestFile = async (req: AuthRequest): Promise<void> => {
  if (req.file?.filename) await removeUploadedFile(req.file.filename);
};

const populateProject = (id: unknown) => Project.findById(id)
  .populate({ path: 'batch', select: 'name course', populate: { path: 'course', select: 'title' } })
  .populate('uploadedBy', 'name username');

export const getProjects = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batch = typeof req.query.batch === 'string' ? req.query.batch.trim() : '';
    let query: Record<string, unknown> = {};

    if (req.user?.role === 'student') {
      const batches = await Batch.find({ students: req.user.id, isActive: true }).select('_id');
      query = { batch: { $in: batches.map((item) => item._id) } };
    } else if (batch) {
      query = { batch };
    }

    const projects = await Project.find(query)
      .populate({ path: 'batch', select: 'name course', populate: { path: 'course', select: 'title' } })
      .populate('uploadedBy', 'name username')
      .sort({ createdAt: -1 });

    res.json({ success: true, projects });
  } catch {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createProject = async (req: AuthRequest, res: Response): Promise<void> => {
  let projectCreated = false;
  try {
    const batch = cleanString(req.body.batch);
    const name = cleanString(req.body.name);
    const resourceType = cleanString(req.body.resourceType) as ProjectResourceType;
    const resourceUrl = cleanString(req.body.resourceUrl);

    if (!batch || !name || !['drive', 'github', 'zip'].includes(resourceType)) {
      await removeRequestFile(req);
      res.status(400).json({ success: false, message: 'Batch, project name and resource type are required' });
      return;
    }
    if (!(await Batch.exists({ _id: batch }))) {
      await removeRequestFile(req);
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }
    if (resourceType !== 'zip' && !isValidProjectResourceUrl(resourceType, resourceUrl)) {
      await removeRequestFile(req);
      res.status(400).json({ success: false, message: resourceType === 'github' ? 'Enter a valid GitHub repository link' : 'Enter a valid Google Drive link' });
      return;
    }
    if (resourceType !== 'zip' && req.file) {
      await removeRequestFile(req);
      req.file = undefined;
    }
    if (resourceType === 'zip' && !req.file) {
      res.status(400).json({ success: false, message: 'Choose a ZIP file for this project' });
      return;
    }

    const project = await Project.create({
      batch,
      name,
      description: cleanString(req.body.description),
      skills: parseSkills(req.body.skills),
      resourceType,
      resourceUrl: resourceType !== 'zip' ? resourceUrl : undefined,
      fileName: resourceType === 'zip' ? req.file?.filename : undefined,
      originalFileName: resourceType === 'zip' ? req.file?.originalname : undefined,
      uploadedBy: req.user!.id,
    });
    projectCreated = true;

    res.status(201).json({ success: true, project: await populateProject(project._id) });
  } catch {
    if (!projectCreated) await removeRequestFile(req).catch(() => undefined);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateProject = async (req: AuthRequest, res: Response): Promise<void> => {
  let projectSaved = false;
  try {
    const project = await Project.findById(req.params.id).select('+fileName');
    if (!project) {
      await removeRequestFile(req);
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const nextBatch = req.body.batch === undefined ? String(project.batch) : cleanString(req.body.batch);
    const nextName = req.body.name === undefined ? project.name : cleanString(req.body.name);
    const nextType = (req.body.resourceType === undefined ? project.resourceType : cleanString(req.body.resourceType)) as ProjectResourceType;
    const nextUrl = req.body.resourceUrl === undefined ? cleanString(project.resourceUrl) : cleanString(req.body.resourceUrl);

    if (!nextBatch || !nextName || !['drive', 'github', 'zip'].includes(nextType)) {
      await removeRequestFile(req);
      res.status(400).json({ success: false, message: 'Batch, project name and resource type are required' });
      return;
    }
    if (!(await Batch.exists({ _id: nextBatch }))) {
      await removeRequestFile(req);
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }
    if (nextType !== 'zip' && !isValidProjectResourceUrl(nextType, nextUrl)) {
      await removeRequestFile(req);
      res.status(400).json({ success: false, message: nextType === 'github' ? 'Enter a valid GitHub repository link' : 'Enter a valid Google Drive link' });
      return;
    }
    if (nextType !== 'zip' && req.file) {
      await removeRequestFile(req);
      req.file = undefined;
    }
    if (nextType === 'zip' && !req.file && !project.fileName) {
      res.status(400).json({ success: false, message: 'Choose a ZIP file for this project' });
      return;
    }

    const oldFileName = project.fileName;
    project.batch = nextBatch as unknown as typeof project.batch;
    project.name = nextName;
    project.description = req.body.description === undefined ? project.description : cleanString(req.body.description);
    project.skills = req.body.skills === undefined ? project.skills : parseSkills(req.body.skills);
    project.resourceType = nextType;
    project.resourceUrl = nextType !== 'zip' ? nextUrl : undefined;
    project.fileName = nextType === 'zip' ? (req.file?.filename || project.fileName) : undefined;
    project.originalFileName = nextType === 'zip' ? (req.file?.originalname || project.originalFileName) : undefined;
    await project.save();
    projectSaved = true;

    if (oldFileName && (nextType !== 'zip' || (req.file && oldFileName !== req.file.filename))) {
      await removeUploadedFile(oldFileName).catch(() => undefined);
    }

    res.json({ success: true, project: await populateProject(project._id) });
  } catch {
    if (!projectSaved) await removeRequestFile(req).catch(() => undefined);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const downloadProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await Project.findById(req.params.id).select('+fileName');
    if (!project || project.resourceType !== 'zip' || !project.fileName) {
      res.status(404).json({ success: false, message: 'Project ZIP file not found' });
      return;
    }

    if (req.user?.role === 'student') {
      const hasAccess = await Batch.exists({ _id: project.batch, students: req.user.id, isActive: true });
      if (!hasAccess) {
        res.status(403).json({ success: false, message: 'You do not have access to this project' });
        return;
      }
    }

    const downloadPath = path.join(projectUploadDir, path.basename(project.fileName));
    await fs.access(downloadPath);
    res.download(
      downloadPath,
      project.originalFileName || `${project.name}.zip`,
    );
  } catch {
    res.status(500).json({ success: false, message: 'Unable to download project file' });
  }
};

export const deleteProject = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id).select('+fileName');
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    await removeUploadedFile(project.fileName).catch(() => undefined);
    res.json({ success: true, message: 'Project deleted' });
  } catch {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
