import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluarCambioEtiquetaCrudaCrucePlanRevision } from '../services/librillos.service.js';

test('reetiquetado: solo marca cambio si viene del cruce plan→revisión', () => {
  const ok = evaluarCambioEtiquetaCrudaCrucePlanRevision({
    sucursal_antes: 'CRAX',
    sucursal_despues: '8262',
    fuente: 'bd_servidor',
  });
  assert.equal(ok.cambio, true);
  assert.equal(ok.puesto_original, 'CRAX');
  assert.equal(ok.puesto_nuevo, '8262');
  assert.equal(ok.fuente, 'bd_servidor');

  const sinCruce = evaluarCambioEtiquetaCrudaCrucePlanRevision(null);
  assert.equal(sinCruce.cambio, false);

  const victor = evaluarCambioEtiquetaCrudaCrucePlanRevision({
    sucursal_antes: 'VICTOR HUGO Y CIA',
    sucursal_despues: '02074',
  });
  assert.equal(victor.cambio, false);
});
