import express from 'express';
import { getDashboardResumen, getDashboardCierre } from '../controllers/dashboard.controller.js';

const router = express.Router();

router.get('/resumen', getDashboardResumen); // ?fecha=YYYY-MM-DD
router.get('/cierre', getDashboardCierre);   // ?fecha=YYYY-MM-DD

export default router;

