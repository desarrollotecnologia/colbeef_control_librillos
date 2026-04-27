import express from 'express';
import { getHistoricoCambios } from '../controllers/auditoria.controller.js';

const router = express.Router();

router.get('/cambios', getHistoricoCambios);

export default router;
