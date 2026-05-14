import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import librillosRoutes from './routes/librillos.routes.js';
import salidasRoutes from './routes/salidas.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import auditoriaRoutes from './routes/auditoria.routes.js';
import guiasRoutes from './routes/guias.routes.js';
import cierreProcesoRoutes from './routes/cierre-proceso.routes.js';
import { iniciarPolling } from './services/librillos.service.js';
import { pool } from './config/db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
const httpCompression =
  String(process.env.HTTP_COMPRESSION || '1').trim() !== '0' &&
  String(process.env.HTTP_COMPRESSION || '1').trim().toLowerCase() !== 'false';
if (httpCompression) {
  app.use(compression({ threshold: 1024 }));
}
app.use(express.json());

// URL oficial de acceso en red local (evita confusión localhost vs IP compartida).
// Configurable vía .env (OFFICIAL_HOST). Si está vacío, se desactiva la redirección.
const OFFICIAL_HOST = String(process.env.OFFICIAL_HOST || '').trim();
const OFFICIAL_PORT = String(process.env.PORT || 3001);
const OFFICIAL_BASE_URL = OFFICIAL_HOST ? `http://${OFFICIAL_HOST}:${OFFICIAL_PORT}` : '';

if (OFFICIAL_BASE_URL) {
  app.use((req, res, next) => {
    try {
      const hostHeader = String(req.headers.host || '').toLowerCase();
      const hostOnly = hostHeader.split(':')[0];
      if (hostOnly === 'localhost' || hostOnly === '127.0.0.1') {
        const target = `${OFFICIAL_BASE_URL}${req.originalUrl || '/'}`;
        return res.redirect(302, target);
      }
    } catch {
      // ignore
    }
    return next();
  });
}

app.use('/api/librillos', librillosRoutes);
app.use('/api/salidas', salidasRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/guias', guiasRoutes);
app.use('/api/cierre-proceso', cierreProcesoRoutes);

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({
      ok: false,
      db: 'down',
      error: String(e.message || e),
      time: new Date().toISOString(),
    });
  }
});

// Interfaz web (sin caché agresiva: el navegador suele guardar app.js y parece que "no toma cambios")
app.use(
  express.static(path.join(__dirname, 'frontend'), {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    },
  })
);

const PORT = process.env.PORT || 3001;
// Escucha en toda la red (evita "no se puede acceder" por bind a localhost)
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log('GET /api/health — estado de base de datos');
  console.log('GET /api/librillos/validacion?fecha=YYYY-MM-DD — cuadre de movimientos');
  console.log('GET /api/librillos/diagnostico?fecha=YYYY-MM-DD — estado real (día/pendiente/otro día)');
  await iniciarPolling();
});