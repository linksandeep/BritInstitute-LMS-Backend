import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.middleware';
import { createStudyPlan, getStudentPortalSummary, requestCertificate } from '../controllers/studentPortal.controller';

const router = Router();

router.use(protect, authorize(['student']));

router.get('/summary', getStudentPortalSummary);
router.post('/study-plan', createStudyPlan);
router.post('/certificate-request', requestCertificate);

export default router;
