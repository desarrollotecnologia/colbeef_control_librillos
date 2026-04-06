import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import librillosRoutes from './routes/librillos.routes.js';
import salidasRoutes from './routes/salidas.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import { iniciarPolling } from './services/librillos.service.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/librillos', librillosRoutes);
app.use('/api/salidas', salidasRoutes);
app.use('/api/dashboard', dashboardRoutes);

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

const PORT = process.env.PORT || 3000;
// Escucha en toda la red (evita "no se puede acceder" por bind a localhost)
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log('GET /api/librillos/validacion?fecha=YYYY-MM-DD — cuadre de movimientos');
  await iniciarPolling();
});