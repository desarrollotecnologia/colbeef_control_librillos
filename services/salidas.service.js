import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVO = path.join(__dirname, '../data/salidas.json');

/** true = solo archivo JSON (desarrollo sin tabla). false = PostgreSQL colbeef.salidas_cava */
const USE_FILE =
  process.env.SALIDAS_USE_FILE === '1' ||
  process.env.SALIDAS_USE_FILE === 'true';

console.log(
  `📋 Salidas: ${USE_FILE ? 'archivo (data/salidas.json)' : 'PostgreSQL colbeef.salidas_cava (lectura cae a JSON si falla)'}`
);

const dir = path.dirname(ARCHIVO);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(ARCHIVO)) fs.writeFileSync(ARCHIVO, JSON.stringify([]));

// ── Archivo JSON (fallback / dev) ───────────────────────────────────────────
const leerSalidasFile = () => {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  } catch {
    return [];
  }
};

const guardarSalidasFile = (salidas) => {
  fs.writeFileSync(ARCHIVO, JSON.stringify(salidas, null, 2));
};

function rowPgToApi(r) {
  const iso = (v) => (v instanceof Date ? v.toISOString() : v);
  return {
    id: r.id,
    id_producto: r.id_producto,
    fecha_salida: iso(r.fecha_salida),
    registrado_por: r.registrado_por,
    fecha_registro: iso(r.fecha_registro),
    editado_por: r.editado_por || undefined,
    fecha_edicion: r.fecha_edicion ? iso(r.fecha_edicion) : undefined,
  };
}

// ── PostgreSQL ───────────────────────────────────────────────────────────────
async function obtenerSalidasPg() {
  const res = await pool.query(
    `SELECT id, id_producto, fecha_salida, registrado_por, fecha_registro, editado_por, fecha_edicion
     FROM colbeef.salidas_cava
     ORDER BY fecha_registro DESC`
  );
  return res.rows.map(rowPgToApi);
}

async function registrarSalidasPg(ids_productos, usuario = 'usuario') {
  const ahora = new Date();
  const nuevas = [];
  let seq = 0;

  for (const id of ids_productos) {
    const existe = await pool.query(
      'SELECT 1 FROM colbeef.salidas_cava WHERE id_producto = $1',
      [id]
    );
    if (existe.rowCount > 0) continue;

    const rowId = `${id}-${Date.now()}-${seq++}`;
    await pool.query(
      `INSERT INTO colbeef.salidas_cava (id, id_producto, fecha_salida, registrado_por, fecha_registro)
       VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz)`,
      [rowId, id, ahora.toISOString(), usuario, ahora.toISOString()]
    );
    nuevas.push({
      id: rowId,
      id_producto: id,
      fecha_salida: ahora.toISOString(),
      registrado_por: usuario,
      fecha_registro: ahora.toISOString(),
    });
  }
  return nuevas;
}

async function editarSalidaPg(id, fecha_salida, usuario_rol) {
  const res = await pool.query(
    'SELECT id, id_producto, fecha_registro FROM colbeef.salidas_cava WHERE id = $1',
    [id]
  );
  if (res.rowCount === 0) return null;

  // Fuerza rol admin en edición para evitar bloqueos heredados
  // por validaciones antiguas de "más de 1 hora".
  const rolEdicion = 'admin';
  const upd = await pool.query(
    `UPDATE colbeef.salidas_cava
     SET fecha_salida = $2::timestamptz, editado_por = $3, fecha_edicion = NOW()
     WHERE id = $1
     RETURNING id, id_producto, fecha_salida, registrado_por, fecha_registro, editado_por, fecha_edicion`,
    [id, fecha_salida, rolEdicion]
  );
  return rowPgToApi(upd.rows[0]);
}

async function eliminarSalidaPg(id) {
  const r = await pool.query('DELETE FROM colbeef.salidas_cava WHERE id = $1', [id]);
  return r.rowCount > 0;
}

// ── API unificada ────────────────────────────────────────────────────────────
export const obtenerSalidas = async () => {
  if (USE_FILE) return leerSalidasFile();
  try {
    return await obtenerSalidasPg();
  } catch (e) {
    console.error('❌ salidas PostgreSQL:', e.message, '→ usando archivo');
    return leerSalidasFile();
  }
};

export const registrarSalidas = async (ids_productos, usuario = 'usuario') => {
  if (USE_FILE) {
    const salidas = leerSalidasFile();
    const ahora = new Date().toISOString();
    const nuevas = [];
    ids_productos.forEach((id) => {
      if (salidas.find((s) => s.id_producto === id)) return;
      const nueva = {
        id: `${id}-${Date.now()}`,
        id_producto: id,
        fecha_salida: ahora,
        registrado_por: usuario,
        fecha_registro: ahora,
      };
      salidas.push(nueva);
      nuevas.push(nueva);
    });
    guardarSalidasFile(salidas);
    return nuevas;
  }
  try {
    return await registrarSalidasPg(ids_productos, usuario);
  } catch (e) {
    console.error('❌ registrarSalidas PG:', e.message);
    throw e;
  }
};

export const editarSalida = async (id, fecha_salida, usuario_rol) => {
  if (USE_FILE) {
    const salidas = leerSalidasFile();
    const idx = salidas.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    salidas[idx].fecha_salida = fecha_salida;
    salidas[idx].editado_por = usuario_rol;
    salidas[idx].fecha_edicion = new Date().toISOString();
    guardarSalidasFile(salidas);
    return salidas[idx];
  }
  return editarSalidaPg(id, fecha_salida, usuario_rol);
};

export const eliminarSalida = async (id) => {
  if (USE_FILE) {
    const salidas = leerSalidasFile();
    const idx = salidas.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    salidas.splice(idx, 1);
    guardarSalidasFile(salidas);
    return true;
  }
  return eliminarSalidaPg(id);
};
