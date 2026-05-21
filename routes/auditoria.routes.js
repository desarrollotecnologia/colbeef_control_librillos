import express from 'express';
import {
  getHistoricoCambios,
  getReimpresionesCrudas,
  postReimpresionCrudas,
} from '../controllers/auditoria.controller.js';

const router = express.Router();

router.get('/cambios', getHistoricoCambios);
router.get('/reimpresion-crudas', getReimpresionesCrudas);
router.post('/reimpresion-crudas', postReimpresionCrudas);

export default router;
