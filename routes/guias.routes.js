import express from 'express';
import { getGuiaPorCodigo } from '../controllers/guias.controller.js';

const router = express.Router();

router.get('/:codigo', getGuiaPorCodigo);

export default router;

