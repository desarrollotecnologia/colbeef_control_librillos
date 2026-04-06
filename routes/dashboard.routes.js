import express from 'express';
import { getDashboardResumen } from '../controllers/dashboard.controller.js';

const router = express.Router();

router.get('/resumen', getDashboardResumen); // ?fecha=YYYY-MM-DD

export default router;

