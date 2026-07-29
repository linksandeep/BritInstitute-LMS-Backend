import { Router } from 'express';
import { activateSoftwareLicense, checkSoftwareLicense } from '../services/license.service';

const router = Router();

router.get('/status', async (_req, res) => {
  const status = await checkSoftwareLicense();
  res.status(status.allowed ? 200 : 423).json({
    success: status.allowed,
    license: {
      mode: status.mode,
      expiresAt: status.expiresAt,
      message: status.message,
    },
  });
});

router.post('/activate', async (req, res) => {
  const status = await activateSoftwareLicense(String(req.body?.licenseKey || ''));
  res.status(status.allowed ? 200 : 423).json({
    success: status.allowed,
    license: {
      mode: status.mode,
      expiresAt: status.expiresAt,
      message: status.message,
    },
  });
});

export default router;
