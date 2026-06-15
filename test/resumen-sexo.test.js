import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarSexoProducto } from '../services/librillos/resumen-sexo.js';

describe('clasificarSexoProducto', () => {
  it('clasifica hembras', () => {
    assert.equal(clasificarSexoProducto('hembra'), 'hembra');
    assert.equal(clasificarSexoProducto('H'), 'hembra');
    assert.equal(clasificarSexoProducto('vaca'), 'hembra');
  });

  it('clasifica machos', () => {
    assert.equal(clasificarSexoProducto('macho'), 'macho');
    assert.equal(clasificarSexoProducto('M'), 'macho');
    assert.equal(clasificarSexoProducto('novillo'), 'macho');
    assert.equal(clasificarSexoProducto('toro'), 'macho');
  });

  it('sin sexo o desconocido', () => {
    assert.equal(clasificarSexoProducto(''), 'sin_sexo');
    assert.equal(clasificarSexoProducto(null), 'sin_sexo');
    assert.equal(clasificarSexoProducto('otro'), 'sin_sexo');
  });
});
