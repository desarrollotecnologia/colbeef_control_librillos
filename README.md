# Colbeef — Control de Librillos

Tablero operativo para librillos y chunchullas crudas (plan de faena, parte Colbeef, despacho de cava, reportes).

## Requisitos

- Node.js >= 18
- PostgreSQL (trazabilidad Colbeef)
- Archivo `.env` (copiar desde `.env.example`)

## Arranque

```bash
npm install
cp .env.example .env   # completar credenciales
npm run verify
npm start
```

Abrir `http://<host>:<PORT>/` (por defecto puerto 3001 u 8080 según `.env`).

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Servidor Express + polling de caché |
| `npm test` | Pruebas unitarias (reglas de negocio) |
| `npm run verify` | Comprueba `.env` y conexión BD |
| `npm run db:salidas-schema` | Tabla `colbeef.salidas_cava` |
| `npm run db:auditoria-schema` | Tabla auditoría |

## API principal

- `GET /api/health` — BD, caché del turno, último poll
- `GET /api/librillos?fecha=YYYY-MM-DD` — listado (incluye `clasificacion_movimiento`)
- `GET /api/librillos/resumen?fecha=` — resumen macro del día
- `GET /api/librillos/validacion?fecha=` — cuadre movimientos / despachos
- `POST /api/salidas` — registrar despacho (`X-Colbeef-Usuario` opcional)

Documentación operativa: `MANUAL-DE-USUARIO-COLBEEF.md`.

## Estructura (refactor)

```
services/
  librillos.service.js      # consulta BD + ensamblado de filas
  librillos/
    observacion.parser.js   # parseo RETIRAR LIBRILLOS / plaza
    fecha-bogota.js         # turno operativo (corte 6:00)
    cache-store.js          # caché en memoria
    resumen-macro.js        # conteos resumen día
  clasificacion-movimiento.service.js
middleware/                 # contexto, rate limit, errores
lib/                        # logger, runtime-state
test/                       # pruebas unitarias
```

## Cabeceras opcionales

- `X-Colbeef-Usuario`: usuario real en despachos y cierre (si no, `usuario`).
- `X-Request-Id`: correlación de logs (se genera si falta).

## Variables nuevas (.env)

- `POSTGRES_SSL=1` — SSL hacia BD remota
- `LOG_LEVEL=info|debug|warn|error`
- `RATE_LIMIT_WRITES_PER_MIN=120`
