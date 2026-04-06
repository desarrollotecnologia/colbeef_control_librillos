import express from 'express';
import {
  getSalidas,
  postSalidas,
  putSalida,
  deleteSalida,
} from '../controllers/salidas.controller.js';

const router = express.Router();

router.get('/',        getSalidas);
router.post('/',       postSalidas);
router.put('/:id',     putSalida);
router.delete('/:id',  deleteSalida);

export default router;
