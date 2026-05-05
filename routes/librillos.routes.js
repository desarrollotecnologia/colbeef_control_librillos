import express from 'express';
import {
  getLibrillos,
  getObservaciones,
  getEstadoCache,
  getStats,
  getValidacion,
  getDiagnostico,
  getAuditoriaClasificacion,
  getConfigOperacion,
  getResumenMacro,
} from '../controllers/librillos.controller.js';

const router = express.Router();

router.get('/validacion', getValidacion); // ?fecha=YYYY-MM-DD
router.get('/diagnostico', getDiagnostico); // ?fecha=YYYY-MM-DD
router.get('/auditoria-clasificacion', getAuditoriaClasificacion); // ?fecha=YYYY-MM-DD
router.get('/config', getConfigOperacion);
router.get('/resumen', getResumenMacro); // ?fecha=YYYY-MM-DD
router.get('/observaciones', getObservaciones); // ?fecha=YYYY-MM-DD
router.get('/', getLibrillos);            // ?fecha=YYYY-MM-DD opcional
router.get('/estado', getEstadoCache);    // Info del cache
router.get('/stats', getStats);           // Producción últimos 7 días

export default router;