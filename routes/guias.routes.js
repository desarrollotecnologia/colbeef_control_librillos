import express from 'express';
import { getGuiaGenerada, getGuiaPorCodigo } from '../controllers/guias.controller.js';

const router = express.Router();

router.get('/generar', getGuiaGenerada);
router.get('/:codigo', getGuiaPorCodigo);

export default router;

