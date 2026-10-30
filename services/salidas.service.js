import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMySQLPool, isMySQLReady } from '../config/mysql.js';
import { registrarCambioHistorico } from './auditoria.service.js';
import { invalidarCacheTurnoActual } from './librillos.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = path.join(__dirname, '../data/salidas.json');

const dir = path.dirname(ARCHIVO);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(ARCHIVO)) fs.writeFileSync(ARCHIVO, JSON.stringify([]));

function usarMySQL() {
  const forzarArchivo = process.env.SALIDAS_USE_FILE === '1' || process.env.SALIDAS_USE_FILE === 'true';
  return !forzarArchivo && isMySQLReady();
}

console.log('📋 Salidas: MySQL local (colbeef_librillos.salidas) con fallback a JSON');

// ── Archivo JSON (fallback) ──────────────────────────────────────────────────
const leerSalidasFile = () => {
  try {
    const data = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    return Array.isArray(data) ? data : Object.values(data);
  } catch { return []; }
};

const guardarSalidasFile = (salidas) => {
  fs.writeFileSync(ARCHIVO, JSON.stringify(salidas, null, 2));
};

function rowToApi(r) {
  const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? undefined);
  return {
    id:             r.id,
    id_producto:    r.id_producto,
    fecha_salida:   iso(r.fecha_salida),
    registrado_por: r.registrado_por,
    fecha_registro: iso(r.fecha_registro),
    editado_por:    r.editado_por  || undefined,
    fecha_edicion:  r.fecha_edicion ? iso(r.fecha_edicion) : undefined,
  };
}

// ── MySQL ────────────────────────────────────────────────────────────────────
async function obtenerSalidasMySQL() {
  const db = getMySQLPool();
  const [rows] = await db.query(
    `SELECT id, id_producto, fecha_salida, registrado_por, fecha_registro, editado_por, fecha_edicion
     FROM salidas ORDER BY fecha_registro DESC`
  );
  return (rows || []).map(rowToApi);
}

async function registrarSalidasMySQL(ids_productos, usuario = 'usuario') {
  const db = getMySQLPool();
  const ahora = new Date();
  const nuevas = [];
  let seq = 0;
  for (const id of ids_productos) {
    const [[existe]] = await db.query('SELECT id FROM salidas WHERE id_producto = ?', [id]);
    if (existe) continue;
    const rowId = `${id}-${Date.now()}-${seq++}`;
    await db.query(
      `INSERT IGNORE INTO salidas (id, id_producto, fecha_salida, registrado_por, fecha_registro)
       VALUES (?, ?, ?, ?, ?)`,
      [rowId, id, ahora, usuario, ahora]
    );
    nuevas.push({ id: rowId, id_producto: id, fecha_salida: ahora.toISOString(),
                  registrado_por: usuario, fecha_registro: ahora.toISOString() });
  }
  return nuevas;
}

async function editarSalidaMySQL(id, fecha_salida) {
  const db = getMySQLPool();
  const [[row]] = await db.query('SELECT * FROM salidas WHERE id = ?', [id]);
  if (!row) return null;
  await db.query(
    `UPDATE salidas SET fecha_salida = ?, editado_por = 'admin', fecha_edicion = NOW(3) WHERE id = ?`,
    [new Date(fecha_salida), id]
  );
  const [[upd]] = await db.query('SELECT * FROM salidas WHERE id = ?', [id]);
  return rowToApi(upd);
}

async function eliminarSalidaMySQL(id) {
  const db = getMySQLPool();
  const [res] = await db.query('DELETE FROM salidas WHERE id = ?', [id]);
  return res.affectedRows > 0;
}

// ── API unificada ────────────────────────────────────────────────────────────
export const obtenerSalidas = async () => {
  if (usarMySQL()) {
    try { return await obtenerSalidasMySQL(); }
    catch (e) { console.error('❌ salidas MySQL:', e.message, '→ usando archivo'); }
  }
  return leerSalidasFile();
};

export const registrarSalidas = async (ids_productos, usuario = 'usuario') => {
  const usuarioTxt = String(usuario || 'usuario');

  if (usarMySQL()) {
    try {
      const out = await registrarSalidasMySQL(ids_productos, usuarioTxt);
      if (out.length) {
        invalidarCacheTurnoActual();
        await registrarCambioHistorico({
          modulo: 'salidas', accion: 'registrar', entidad: 'salidas_cava',
          idEntidad: out.length === 1 ? out[0].id : null, usuario: usuarioTxt,
          antes: null, despues: { total: out.length, ids: out.map((x) => x.id_producto) },
        });
      }
      return out;
    } catch (e) { console.error('❌ registrarSalidas MySQL:', e.message); throw e; }
  }

  // Fallback: archivo
  const salidas = leerSalidasFile();
  const ahora = new Date().toISOString();
  const nuevas = [];
  ids_productos.forEach((id) => {
    if (salidas.find((s) => s.id_producto === id)) return;
    const nueva = { id: `${id}-${Date.now()}`, id_producto: id,
                    fecha_salida: ahora, registrado_por: usuarioTxt, fecha_registro: ahora };
    salidas.push(nueva); nuevas.push(nueva);
  });
  guardarSalidasFile(salidas);
  if (nuevas.length) {
    invalidarCacheTurnoActual();
    await registrarCambioHistorico({
      modulo: 'salidas', accion: 'registrar', entidad: 'salidas_cava',
      idEntidad: nuevas.length === 1 ? nuevas[0].id : null, usuario: usuarioTxt,
      antes: null, despues: { total: nuevas.length, ids: nuevas.map((x) => x.id_producto) },
    });
  }
  return nuevas;
};

export const editarSalida = async (id, fecha_salida, usuario_rol) => {
  const usuarioTxt = String(usuario_rol || 'usuario');

  if (usarMySQL()) {
    try {
      const db = getMySQLPool();
      const [[antes]] = await db.query('SELECT * FROM salidas WHERE id = ?', [id]);
      const editada = await editarSalidaMySQL(id, fecha_salida);
      if (editada) {
        invalidarCacheTurnoActual();
        await registrarCambioHistorico({
          modulo: 'salidas', accion: 'editar', entidad: 'salidas_cava',
          idEntidad: id, usuario: usuarioTxt, antes: antes ? rowToApi(antes) : null, despues: editada,
        });
      }
      return editada;
    } catch (e) { console.error('❌ editarSalida MySQL:', e.message); throw e; }
  }

  const salidas = leerSalidasFile();
  const idx = salidas.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const antes = { ...salidas[idx] };
  salidas[idx].fecha_salida = fecha_salida;
  salidas[idx].editado_por = usuarioTxt;
  salidas[idx].fecha_edicion = new Date().toISOString();
  guardarSalidasFile(salidas);
  invalidarCacheTurnoActual();
  await registrarCambioHistorico({
    modulo: 'salidas', accion: 'editar', entidad: 'salidas_cava',
    idEntidad: id, usuario: usuarioTxt, antes, despues: salidas[idx],
  });
  return salidas[idx];
};

export const eliminarSalida = async (id, usuario = 'admin') => {
  const usuarioTxt = String(usuario || 'admin');

  if (usarMySQL()) {
    try {
      const db = getMySQLPool();
      const [[antes]] = await db.query('SELECT * FROM salidas WHERE id = ?', [id]);
      const ok = await eliminarSalidaMySQL(id);
      if (ok) {
        invalidarCacheTurnoActual();
        await registrarCambioHistorico({
          modulo: 'salidas', accion: 'eliminar', entidad: 'salidas_cava',
          idEntidad: id, usuario: usuarioTxt, antes: antes ? rowToApi(antes) : null, despues: null,
        });
      }
      return ok;
    } catch (e) { console.error('❌ eliminarSalida MySQL:', e.message); throw e; }
  }

  const salidas = leerSalidasFile();
  const idx = salidas.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  const antes = { ...salidas[idx] };
  salidas.splice(idx, 1);
  guardarSalidasFile(salidas);
  invalidarCacheTurnoActual();
  await registrarCambioHistorico({
    modulo: 'salidas', accion: 'eliminar', entidad: 'salidas_cava',
    idEntidad: id, usuario: usuarioTxt, antes, despues: null,
  });
  return true;
};
