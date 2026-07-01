import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { FoundationResource } from '../models/FoundationResource.model';
import { VideoType } from '../models/RecordedLecture.model';

const videoTypes: VideoType[] = ['youtube', 'drive', 'google_meet', 'zoom', 'other'];

const getVideoType = (value: unknown): VideoType => {
  const type = String(value || 'other');
  return videoTypes.includes(type as VideoType) ? type as VideoType : 'other';
};

const getCleanString = (value: unknown) => String(value || '').trim();

export const getFoundationResources = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const resources = await FoundationResource.find().sort({ order: 1, createdAt: -1 });
    res.json({ success: true, resources });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const createFoundationResource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const title = getCleanString(req.body.title);
    const videoUrl = getCleanString(req.body.videoUrl);
    if (!title || !videoUrl) {
      res.status(400).json({ success: false, message: 'Title and video URL are required' });
      return;
    }

    const resource = await FoundationResource.create({
      title,
      videoUrl,
      description: getCleanString(req.body.description),
      videoType: getVideoType(req.body.videoType),
      order: Number.isFinite(Number(req.body.order)) ? Number(req.body.order) : 0,
      uploadedBy: req.user!.id,
    });

    res.status(201).json({ success: true, resource });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateFoundationResource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const resource = await FoundationResource.findById(req.params.id);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Foundation resource not found' });
      return;
    }

    if (req.body.title !== undefined) {
      const title = getCleanString(req.body.title);
      if (!title) {
        res.status(400).json({ success: false, message: 'Title is required' });
        return;
      }
      resource.title = title;
    }
    if (req.body.videoUrl !== undefined) {
      const videoUrl = getCleanString(req.body.videoUrl);
      if (!videoUrl) {
        res.status(400).json({ success: false, message: 'Video URL is required' });
        return;
      }
      resource.videoUrl = videoUrl;
    }
    if (req.body.description !== undefined) resource.description = getCleanString(req.body.description);
    if (req.body.videoType !== undefined) resource.videoType = getVideoType(req.body.videoType);
    if (req.body.order !== undefined) {
      const order = Number(req.body.order);
      resource.order = Number.isFinite(order) ? order : 0;
    }

    await resource.save();
    res.json({ success: true, resource });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteFoundationResource = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const resource = await FoundationResource.findByIdAndDelete(req.params.id);
    if (!resource) {
      res.status(404).json({ success: false, message: 'Foundation resource not found' });
      return;
    }
    res.json({ success: true, message: 'Foundation resource deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
