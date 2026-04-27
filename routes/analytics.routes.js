import express from 'express';
import { getAnalyticsResumen, postAnalyticsEvent } from '../controllers/analytics.controller.js';

const router = express.Router();

router.post('/event', postAnalyticsEvent);
router.get('/resumen-admin', getAnalyticsResumen); // privado: ?key=...&desde=YYYY-MM-DD&hasta=YYYY-MM-DD

export default router;
