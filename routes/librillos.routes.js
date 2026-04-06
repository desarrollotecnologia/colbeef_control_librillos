import express from 'express';
import {
  getLibrillos,
  getObservaciones,
  getEstadoCache,
  getStats,
  getValidacion,
} from '../controllers/librillos.controller.js';

const router = express.Router();

router.get('/validacion', getValidacion); // ?fecha=YYYY-MM-DD
router.get('/observaciones', getObservaciones); // ?fecha=YYYY-MM-DD
router.get('/', getLibrillos);            // ?fecha=YYYY-MM-DD opcional
router.get('/estado', getEstadoCache);    // Info del cache
router.get('/stats', getStats);           // Producción últimos 7 días

export default router;