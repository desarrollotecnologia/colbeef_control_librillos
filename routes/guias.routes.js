import express from 'express';
import {
  getGuiaGenerada,
  getGuiaPorCodigo,
  getVerificacionGuia,
} from '../controllers/guias.controller.js';

const router = express.Router();

router.get('/verificar', getVerificacionGuia);
router.get('/generar', getGuiaGenerada);
router.get('/:codigo', getGuiaPorCodigo);

export default router;

