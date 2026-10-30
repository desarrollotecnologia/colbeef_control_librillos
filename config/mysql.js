/**
 * config/mysql.js
 * Conexión al pool MySQL local (colbeef_librillos).
 * Variables de entorno relevantes:
 *   MYSQL_HOST     (default: localhost)
 *   MYSQL_PORT     (default: 3306)
 *   MYSQL_DB       (default: colbeef_librillos)
 *   MYSQL_USER     (default: colbeef_app)
 *   MYSQL_PASSWORD (default: ColbeefLib2026!)
 *   MYSQL_USE      (default: 1) — poner 0 para deshabilitar completamente
 */

import mysql from 'mysql2/promise';

const MYSQL_ENABLED =
  String(process.env.MYSQL_USE ?? '1').trim() !== '0';

let _pool = null;
let _ready = false;
let _initError = null;

function createPool() {
  return mysql.createPool({
    host:               process.env.MYSQL_HOST     || 'localhost',
    port:               Number(process.env.MYSQL_PORT || 3306),
    database:           process.env.MYSQL_DB       || 'colbeef_librillos',
    user:               process.env.MYSQL_USER     || 'colbeef_app',
    password:           process.env.MYSQL_PASSWORD || 'ColbeefLib2026!',
    charset:            'utf8mb4',
    waitForConnections: true,
    connectionLimit:    8,
    queueLimit:         0,
    timezone:           '+00:00',
    namedPlaceholders:  false,
  });
}

/** Inicializa el pool y verifica la conexión. Llámalo una sola vez al arrancar. */
export async function initMySQL() {
  if (!MYSQL_ENABLED) {
    console.log('🟡 MySQL local: deshabilitado (MYSQL_USE=0)');
    return false;
  }
  try {
    _pool = createPool();
    const conn = await _pool.getConnection();
    const [[row]] = await conn.query('SELECT DATABASE() AS db');
    conn.release();
    _ready = true;
    console.log(`✅ MySQL local conectado → ${row.db}`);
    return true;
  } catch (err) {
    _initError = err;
    _ready = false;
    console.warn(`⚠️  MySQL local no disponible: ${err.message} (el sistema seguirá con JSON/PG)`);
    return false;
  }
}

/** Devuelve el pool activo o null si MySQL no está listo. */
export function getMySQLPool() {
  return _ready ? _pool : null;
}

/** true si MySQL está listo para usarse. */
export function isMySQLReady() {
  return _ready;
}

/** Ejecuta una query SQL con parámetros posicionales (?).
 *  Retorna rows[] o lanza si MySQL no está disponible. */
export async function mysqlQuery(sql, params = []) {
  if (!_ready) throw new Error('MySQL no disponible');
  const [rows] = await _pool.query(sql, params);
  return rows;
}

/** Igual que mysqlQuery pero no lanza: devuelve null si falla. */
export async function mysqlQuerySafe(sql, params = []) {
  try {
    return await mysqlQuery(sql, params);
  } catch {
    return null;
  }
}
