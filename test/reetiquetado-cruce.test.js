import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluarCambioEtiquetaCrudaCrucePlanRevision,
  evaluarCambioEtiquetaCrudaRetenida,
} from '../services/librillos.service.js';

test('reetiquetado cruce: solo marca cambio si viene del cruce plan→revisión', () => {
  const ok = evaluarCambioEtiquetaCrudaCrucePlanRevision({
    sucursal_antes: 'CRAX',
    sucursal_despues: '8262',
    fuente: 'bd_servidor',
  });
  assert.equal(ok.cambio, true);
  assert.equal(ok.puesto_original, 'CRAX');
  assert.equal(ok.puesto_nuevo, '8262');

  const sinCruce = evaluarCambioEtiquetaCrudaCrucePlanRevision(null);
  assert.equal(sinCruce.cambio, false);

  const victor = evaluarCambioEtiquetaCrudaCrucePlanRevision({
    sucursal_antes: 'VICTOR HUGO Y CIA',
    sucursal_despues: '02074',
  });
  assert.equal(victor.cambio, false);
});

test('reetiquetado: con cruce disponible ignora auditoría fuera de la lista', () => {
  const soloCruce = evaluarCambioEtiquetaCrudaRetenida({
    puestoOriginal: '02032',
    puestoActual: '01034',
    auditoriaSucursal: {
      sucursal_antes: '02032',
      sucursal_despues: '01034',
    },
    cambioPlanRevision: null,
    usarSoloCrucePlanRevision: true,
  });
  assert.equal(soloCruce.cambio, false);
});

test('reetiquetado: sin cruce usa plan vs despacho y auditoría (ef80c77)', () => {
  const planVsDespacho = evaluarCambioEtiquetaCrudaRetenida({
    puestoOriginal: 'CAVA AJR',
    puestoActual: 'ALEX',
    auditoriaSucursal: { sucursal_despues: 'ALEX' },
    cambioPlanRevision: null,
    usarSoloCrucePlanRevision: false,
  });
  assert.equal(planVsDespacho.cambio, true);
  assert.equal(planVsDespacho.fuente, 'plan_vs_despacho');

  const aud = evaluarCambioEtiquetaCrudaRetenida({
    puestoOriginal: '8262',
    puestoActual: '8262',
    auditoriaSucursal: { sucursal_antes: 'CRAX', sucursal_despues: '8262' },
    cambioPlanRevision: null,
    usarSoloCrucePlanRevision: false,
  });
  assert.equal(aud.cambio, true);
  assert.equal(aud.puesto_original, 'CRAX');
  assert.equal(aud.puesto_nuevo, '8262');
});
