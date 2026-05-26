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
  getCrudasCambioSucursal,
  getCambiosSucursalRevisionPlan,
  getCrudasSucursalGuardadas,
  getCrudasRetenidasEtiqueta,
  getUniversoMeta,
  getPlanSinInsensibilizar,
  getReporteMensualLibrillos,
} from '../controllers/librillos.controller.js';

const router = express.Router();

router.get('/validacion', getValidacion); // ?fecha=YYYY-MM-DD
router.get('/diagnostico', getDiagnostico); // ?fecha=YYYY-MM-DD
router.get('/auditoria-clasificacion', getAuditoriaClasificacion); // ?fecha=YYYY-MM-DD
router.get('/config', getConfigOperacion);
router.get('/reporte-mensual', getReporteMensualLibrillos); // ?anio=YYYY&mes=1-12
router.get('/resumen', getResumenMacro); // ?fecha=YYYY-MM-DD
router.get('/crudas-cambio-sucursal', getCrudasCambioSucursal); // ?fecha=YYYY-MM-DD
router.get('/cambios-sucursal-revision', getCambiosSucursalRevisionPlan); // ?fecha_plan=&fecha_revision=
router.get('/crudas-retenidas-etiqueta', getCrudasRetenidasEtiqueta); // ?fecha_plan=&fecha_despacho=
router.get('/crudas-sucursal-guardadas', getCrudasSucursalGuardadas);
router.get('/observaciones', getObservaciones); // ?fecha=YYYY-MM-DD
router.get('/universo-meta', getUniversoMeta); // ?fecha=YYYY-MM-DD
router.get('/plan-sin-insensibilizar', getPlanSinInsensibilizar); // ?fecha=YYYY-MM-DD
router.get('/', getLibrillos);            // ?fecha=YYYY-MM-DD opcional
router.get('/estado', getEstadoCache);    // Info del cache
router.get('/stats', getStats);           // Producción últimos 7 días

export default router;