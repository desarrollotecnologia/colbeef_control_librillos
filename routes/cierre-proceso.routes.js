import express from 'express';
import {
  getCierreEstado,
  postCierreRegistrar,
  postCierreRevisar,
} from '../controllers/cierre-proceso.controller.js';

const router = express.Router();

router.get('/:fecha', getCierreEstado);
router.post('/:fecha/registrar', postCierreRegistrar);
router.post('/:fecha/revisar', postCierreRevisar);

export default router;
