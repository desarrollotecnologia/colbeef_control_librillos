import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarReporteLibrillosMensual,
  rangoMesReporteLibrillos,
  listaDiasIso,
  listaDiasProcesoIso,
} from '../services/librillos/reporte-mensual.js';

describe('reporte-mensual', () => {
  it('lista días del rango inclusive', () => {
    const d = listaDiasIso('2026-05-01', '2026-05-03');
    assert.equal(d.length, 3);
    assert.deepEqual(d, ['2026-05-01', '2026-05-02', '2026-05-03']);
  });

  it('excluye domingos de los días con proceso', () => {
    const d = listaDiasProcesoIso('2026-05-01', '2026-05-03');
    assert.deepEqual(d, ['2026-05-01', '2026-05-02']);
  });

  it('agrupa por día y canal', () => {
    const registros = [
      {
        id_producto: 'A',
        fecha: '2026-05-09',
        agrupacion_codigo: 'cat',
        observaciones: 'CRUDAS X',
      },
      {
        id_producto: 'B',
        fecha: '2026-05-09',
        agrupacion_codigo: 'derivados_carnicos',
        observaciones: 'LIBRILLO',
      },
      {
        id_producto: 'C',
        fecha: '2026-05-11',
        agrupacion_codigo: 'asurcarnes',
        observaciones: 'LIBRILLO',
      },
    ];
    const r = armarReporteLibrillosMensual(registros, 2026, 5);
    const f9 = r.filas.find((x) => x.fecha === '2026-05-09');
    assert.equal(f9.cat, 1);
    assert.equal(f9.derivados_carnicos, 1);
    assert.equal(r.total_libros, 3);
    assert.equal(r.totales.cat, 1);
  });

  it('no suma registros de domingo en la tabla ni en totales', () => {
    const registros = [
      {
        id_producto: 'DOM',
        fecha: '2026-05-10',
        agrupacion_codigo: 'derivados_carnicos',
        observaciones: 'RETIRAR LIBRILLOS',
      },
      {
        id_producto: 'LUN',
        fecha: '2026-05-11',
        agrupacion_codigo: 'derivados_carnicos',
        observaciones: 'RETIRAR LIBRILLOS',
      },
    ];
    const r = armarReporteLibrillosMensual(registros, 2026, 5);

    assert.equal(r.filas.some((x) => x.fecha === '2026-05-10'), false);
    assert.equal(r.total_libros, 1);
    assert.equal(r.facturacion.total_mes, 1);
  });

  it('rango mes incluye corte anterior', () => {
    const r = rangoMesReporteLibrillos(2026, 5);
    assert.equal(r.desde, '2026-05-01');
    assert.match(r.corte_anterior, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.consulta_desde, r.corte_anterior);
  });
});
