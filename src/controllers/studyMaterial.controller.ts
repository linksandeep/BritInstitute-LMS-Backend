import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { StudyMaterial, StudyMaterialType } from '../models/StudyMaterial.model';
import { Batch } from '../models/Batch.model';

const materialTypes: StudyMaterialType[] = ['drive', 'pdf', 'doc', 'slides', 'sheet', 'link', 'other'];

const getCleanString = (value: unknown) => String(value || '').trim();

const getMaterialType = (value: unknown): StudyMaterialType => {
  const type = String(value || 'link');
  return materialTypes.includes(type as StudyMaterialType) ? type as StudyMaterialType : 'link';
};

export const getStudyMaterials = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batch = typeof req.query.batch === 'string' ? req.query.batch.trim() : '';
    let query: Record<string, unknown> = {};

    if (req.user?.role === 'student') {
      const batches = await Batch.find({ students: req.user.id, isActive: true }).select('_id');
      query = { batch: { $in: batches.map((item) => item._id) } };
    } else if (batch) {
      query = { batch };
    }

    const materials = await StudyMaterial.find(query)
      .populate({ path: 'batch', select: 'name course', populate: { path: 'course', select: 'title' } })
      .populate('uploadedBy', 'name username')
      .sort({ batch: 1, order: 1, createdAt: -1 });

    res.json({ success: true, materials });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const createStudyMaterial = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const title = getCleanString(req.body.title);
    const materialUrl = getCleanString(req.body.materialUrl);
    const batch = getCleanString(req.body.batch);

    if (!batch || !title || !materialUrl) {
      res.status(400).json({ success: false, message: 'Batch, title and material link are required' });
      return;
    }

    const existingBatch = await Batch.findById(batch);
    if (!existingBatch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    const material = await StudyMaterial.create({
      batch,
      title,
      description: getCleanString(req.body.description),
      materialUrl,
      materialType: getMaterialType(req.body.materialType),
      order: Number.isFinite(Number(req.body.order)) ? Number(req.body.order) : 0,
      uploadedBy: req.user!.id,
    });

    res.status(201).json({ success: true, material });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const updateStudyMaterial = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const updates: Record<string, unknown> = {};

    if (req.body.batch !== undefined) {
      const batch = getCleanString(req.body.batch);
      if (!batch) {
        res.status(400).json({ success: false, message: 'Batch is required' });
        return;
      }

      const existingBatch = await Batch.findById(batch);
      if (!existingBatch) {
        res.status(404).json({ success: false, message: 'Batch not found' });
        return;
      }

      updates.batch = batch;
    }

    if (req.body.title !== undefined) {
      const title = getCleanString(req.body.title);
      if (!title) {
        res.status(400).json({ success: false, message: 'Title is required' });
        return;
      }
      updates.title = title;
    }

    if (req.body.materialUrl !== undefined) {
      const materialUrl = getCleanString(req.body.materialUrl);
      if (!materialUrl) {
        res.status(400).json({ success: false, message: 'Material link is required' });
        return;
      }
      updates.materialUrl = materialUrl;
    }

    if (req.body.description !== undefined) updates.description = getCleanString(req.body.description);
    if (req.body.materialType !== undefined) updates.materialType = getMaterialType(req.body.materialType);
    if (req.body.order !== undefined) {
      const order = Number(req.body.order);
      updates.order = Number.isFinite(order) ? order : 0;
    }

    const material = await StudyMaterial.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!material) {
      res.status(404).json({ success: false, message: 'Study material not found' });
      return;
    }

    res.json({ success: true, material });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};

export const deleteStudyMaterial = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const material = await StudyMaterial.findByIdAndDelete(req.params.id);
    if (!material) {
      res.status(404).json({ success: false, message: 'Study material not found' });
      return;
    }

    res.json({ success: true, message: 'Study material deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err });
  }
};
