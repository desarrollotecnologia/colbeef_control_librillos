# Colbeef — Control de Librillos

Sistema web interno para consultar, clasificar y controlar la operación diaria de **librillos y chunchullas crudas** en Colbeef. Integra el plan de faena, el parte de trazabilidad, los movimientos de cava, las etiquetas, los reportes y la auditoría en un único tablero operativo.

## Contenido

- [Objetivo](#objetivo)
- [Funciones principales](#funciones-principales)
- [Tecnologías utilizadas](#tecnologías-utilizadas)
- [Arquitectura](#arquitectura)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Base de datos y persistencia](#base-de-datos-y-persistencia)
- [Ejecución](#ejecución)
- [Despliegue en Windows / LAN](#despliegue-en-windows--lan)
- [Flujo operativo](#flujo-operativo)
- [API REST](#api-rest)
- [Scripts disponibles](#scripts-disponibles)
- [Pruebas](#pruebas)
- [Seguridad y consideraciones de despliegue](#seguridad-y-consideraciones-de-despliegue)
- [Solución de problemas](#solución-de-problemas)

## Objetivo

La aplicación ayuda al personal de operación y despacho a:

- comparar el plan de faena con la información real registrada en el parte Colbeef;
- identificar librillos y crudas pendientes, procesados o despachados;
- clasificar los movimientos por propietario, cliente, plaza y agrupación comercial;
- registrar y consultar salidas de cava;
- generar etiquetas y guías de despacho;
- obtener consolidados diarios y reportes mensuales;
- revisar cambios de sucursal, retenciones y diferencias operativas;
- conservar un histórico de cambios y reimpresiones.

El sistema usa un **turno operativo con zona horaria `America/Bogota`**. Por defecto, los movimientos realizados entre las 00:00 y las 05:59 se asignan al turno del día anterior (`HORA_CORTE_TURNO_SALIDA_BOGOTA=6`). Este corte puede configurarse.

La interfaz, al abrir, selecciona por defecto el día anterior antes de las 13:00 y el día actual desde las 13:00. Ese criterio de apertura no es el mismo que el corte operativo de salidas a las 06:00.

## Funciones principales

### Turno y detalle

- Consulta del universo diario de productos.
- Indicadores de librillos, crudas y total general.
- Comparación entre plan de faena, parte e insensibilización.
- Búsqueda por producto, propietario, cliente y observaciones.
- Diagnóstico y validación de movimientos.

### Inventario y despacho

- Separación entre productos pendientes y despachados.
- Registro de salidas individuales o masivas.
- Corrección de fecha de salida.
- Eliminación administrativa de movimientos.
- Persistencia en PostgreSQL o archivos JSON, según configuración.

### Clasificación comercial

- Agrupación por cliente, propietario y plaza.
- Reglas configurables para librillos, crudas, cocidos y derivados.
- Ajustes manuales de clasificación mediante archivos JSON de configuración.
- Auditoría de la clasificación calculada.

### Reportes y cierre

- Resumen macro diario.
- Reportes por agrupación y rango de fechas.
- Reporte mensual de librillos por día y canal.
- Exportación e impresión desde la interfaz.
- Dashboard ejecutivo con indicadores y gráficos.
- Guías de despacho por fecha y categoría.

### Auditoría y analítica

- Histórico de cambios de planillaje.
- Registro y consulta de reimpresiones de etiquetas de crudas.
- Analítica de uso de las vistas del sistema.
- Identificación de solicitudes mediante `X-Request-Id`.

## Tecnologías utilizadas

### Lenguajes

- **JavaScript (ES Modules):** backend, frontend y reglas de negocio.
- **HTML5 y CSS3:** interfaz web.
- **SQL (PostgreSQL):** consultas, esquemas e índices.
- **Python:** herramienta auxiliar para extraer observaciones desde archivos locales.

### Backend

- **Node.js 18 o superior**
- **Express 5** para servidor HTTP y API REST.
- **pg** para los pools de conexiones PostgreSQL.
- **dotenv** para variables de entorno.
- **cors** para acceso HTTP entre orígenes.
- **compression** para respuestas comprimidas con gzip.
- Módulo nativo `node:test` para pruebas unitarias.

### Frontend

El frontend es una aplicación estática, sin framework SPA:

- HTML, CSS y JavaScript nativo;
- jsPDF y AutoTable para documentos PDF;
- html2pdf para exportación de vistas;
- Chart.js para el dashboard ejecutivo;
- fuentes Barlow y Barlow Condensed.

Algunos recursos se cargan desde CDN y otros desde `frontend/vendor/`. Si el servidor opera sin Internet, todos los recursos externos deben servirse localmente.

### Datos

- PostgreSQL como fuente principal de trazabilidad.
- Caché en memoria por fecha para reducir consultas repetidas.
- Archivos JSON como almacenamiento alternativo para salidas, auditoría y analítica.

## Arquitectura

```text
Navegador
   │
   ├── frontend/index.html + app.js + styles.css
   │
   └── HTTP / JSON
          │
          ▼
     Express (server.js)
          │
          ├── middleware: contexto, rate limit y errores
          ├── routes: definición de endpoints
          ├── controllers: validación de solicitudes
          ├── services: reglas de negocio y ensamblado de datos
          ├── cache: resultados por fecha y polling del turno
          └── PostgreSQL / archivos JSON
```

El backend sigue una separación por capas:

1. `routes/` publica las rutas HTTP.
2. `controllers/` valida parámetros y construye las respuestas.
3. `services/` contiene consultas, cálculos y reglas operativas.
4. `config/` centraliza conexión, reglas y agrupaciones.
5. `middleware/` aplica contexto, límites de escritura y manejo de errores.

`services/librillos.service.js` concentra el núcleo operativo: universo del día, enriquecimiento, clasificación, caché y polling. Parte de esa lógica está modularizada en `services/librillos/`, pero ese servicio sigue siendo el punto central del dominio.

La caché del backend vive en memoria por fecha, rango, cruce de sucursal, reporte mensual y turno. El frontend añade caché local, deduplicación de peticiones y refresco periódico según `frontend/config-ui.json`.

## Estructura del proyecto

```text
.
├── server.js                         # Entrada del servidor Express
├── package.json                      # Dependencias y scripts npm
├── .env.example                      # Plantilla de configuración
├── frontend/
│   ├── index.html                    # Tablero operativo
│   ├── app.js                        # Lógica de interfaz y consumo de API
│   ├── styles.css                    # Estilos
│   ├── dashboard-ejecutivo-librillos.html
│   ├── config-ui.json                # Configuración visual
│   └── vendor/                       # Librerías frontend locales
├── routes/                           # Rutas de librillos, salidas, guías, etc.
├── controllers/                      # Controladores HTTP
├── services/
│   ├── librillos.service.js          # Consulta y ensamblado principal
│   ├── salidas.service.js            # Despachos de cava
│   ├── dashboard.service.js          # Indicadores ejecutivos
│   ├── guias.service.js              # Guías de despacho
│   ├── auditoria.service.js          # Histórico de cambios
│   ├── analytics.service.js          # Eventos de uso
│   └── librillos/                    # Caché, fechas, resumen y parsers
├── config/
│   ├── db.js                         # Pools PostgreSQL y SSL
│   ├── agrupaciones-librillos.json   # Agrupaciones comerciales
│   ├── ajustes-clasificacion-librillos.json
│   └── reglas-librillos.js           # Reglas de clasificación
├── middleware/                       # Contexto, rate limit y errores
├── lib/                              # Logging y estado de ejecución
├── sql/                              # Esquemas propios de la aplicación
├── scripts/                          # Verificación, migraciones y utilidades
├── data/                             # Persistencia JSON opcional
├── test/                             # Pruebas unitarias
└── MANUAL-DE-USUARIO-COLBEEF.md      # Manual operativo
```

## Requisitos

- Node.js `>= 18`.
- npm.
- Acceso a PostgreSQL con las tablas de trazabilidad utilizadas por Colbeef.
- Credenciales con permisos de lectura sobre trazabilidad.
- Permisos de escritura y DDL si se usarán las tablas propias de salidas y auditoría.
- Navegador moderno: Chrome, Edge o Firefox.
- Conectividad con la red interna o VPN donde se encuentre la base de datos.
- Python solo para las utilidades opcionales de archivos locales.

## Instalación

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear el archivo de entorno

En Windows CMD:

```bat
copy .env.example .env
```

En PowerShell:

```powershell
Copy-Item .env.example .env
```

En Linux o macOS:

```bash
cp .env.example .env
```

Edite `.env` y reemplace los datos de ejemplo por las credenciales y parámetros del entorno.

### 3. Verificar PostgreSQL

```bash
npm run verify
```

El comando muestra la base y el usuario conectados. Si falla, revise las variables `POSTGRES_*`, la VPN, el firewall y los permisos del usuario.

### 4. Preparar las tablas propias

Si las salidas se guardarán en PostgreSQL:

```bash
npm run db:salidas-schema
```

Si la auditoría se guardará en PostgreSQL:

```bash
npm run db:auditoria-schema
```

Estos comandos deben ejecutarse con un usuario autorizado para crear esquemas, tablas e índices.

## Configuración

Todas las opciones se definen en `.env`. No confirme este archivo en Git ni comparta credenciales.

### Conexión PostgreSQL

| Variable | Descripción | Ejemplo |
| --- | --- | --- |
| `POSTGRES_HOST` | Servidor PostgreSQL | `127.0.0.1` |
| `POSTGRES_DB` | Nombre de la base | `nombre_bd` |
| `POSTGRES_USER` | Usuario de conexión | `usuario` |
| `POSTGRES_PASSWORD` | Contraseña | `clave_segura` |
| `POSTGRES_PORT` | Puerto PostgreSQL | `5432` |
| `POSTGRES_SSL` | `1` habilita SSL, `0` lo desactiva, vacío lo detecta por host | vacío |

Cuando `POSTGRES_SSL` está vacío, las conexiones locales no usan SSL y las conexiones remotas lo habilitan con `rejectUnauthorized: false`.

### Servidor y observabilidad

| Variable | Descripción | Valor de referencia |
| --- | --- | --- |
| `PORT` | Puerto HTTP | `8080` |
| `OFFICIAL_HOST` | Host oficial; redirige accesos por localhost | vacío |
| `HTTP_COMPRESSION` | Compresión gzip (`1`/`0`) | `1` |
| `LOG_LEVEL` | `debug`, `info`, `warn` o `error` | `info` |
| `RATE_LIMIT_WRITES_PER_MIN` | Máximo de escrituras por IP/ruta/minuto | `120` |
| `COLBEEF_DEBUG` | Logging de diagnóstico adicional | `0` |

### Persistencia

| Variable | Descripción |
| --- | --- |
| `SALIDAS_USE_FILE=1` | Guarda despachos en `data/salidas.json`. |
| `SALIDAS_USE_FILE=0` | Usa `colbeef.salidas_cava`. |
| `AUDITORIA_USE_FILE=1` | Fuerza auditoría en `data/historico-cambios.json`. |
| `AUDITORIA_USE_FILE=0` | Usa `app_auditoria_cambios` cuando está disponible. |

### Rendimiento

| Variable | Descripción |
| --- | --- |
| `PG_STATEMENT_TIMEOUT` | Tiempo máximo de consulta PostgreSQL, por ejemplo `90s`. |
| `PG_POOL_MAX` | Tamaño máximo del pool principal. |
| `PG_VISTA_POOL_MAX` | Tamaño máximo del pool secundario. |
| `PG_CONNECT_TIMEOUT_MS` | Timeout de conexión del pool principal. |
| `PG_VISTA_CONNECT_TIMEOUT_MS` | Timeout del pool secundario. |
| `META_RAIZ_BATCH_SIZE` | Tamaño de lote para metadatos. |
| `META_RAIZ_CONCURRENCY` | Concurrencia de lotes de metadatos. |
| `CACHE_POLL_INTERVAL_MS` | Intervalo de actualización del turno. |
| `CACHE_FECHA_MS` | Vigencia del caché por fecha. |
| `CACHE_CRUCE_SUCURSAL_MS` | Vigencia del caché de cambios de sucursal. |
| `CACHE_RANGO_MS` | Vigencia del caché por rango de fechas. |
| `CACHE_REPORTE_MENSUAL_MS` | Vigencia del caché del reporte mensual. |
| `RANGO_CONCURRENCY` | Concurrencia al consultar rangos. |
| `REPORTE_MENSUAL_DIA_CONCURRENCY` | Concurrencia por día en el reporte mensual. |

### Reglas operativas

| Variable | Descripción |
| --- | --- |
| `HORA_CORTE_TURNO_SALIDA_BOGOTA` | Hora que separa el turno anterior del actual; defecto `6`. |
| `ID_TIPO_PARTE_COLBEEF` | Tipo de parte usado para librillos/vísceras blancas; defecto `14`. |
| `PLAN_FAENA_PFP_TEXT_COLUMNS` | Columnas opcionales del plan con observaciones. |
| `PLAN_FAENA_OBS_PRIORIDAD` | Prioridad `plan_first`, `merge` o `parte_first`. |
| `USE_UNION_PARTE_PLAN_DIA` | Une plan y parte para construir el universo diario. |
| `USE_PLAN_FAENA_UNIVERSE` | Usa el plan como universo base del listado. |
| `PLAN_FAENA_FALLBACK_ON_EMPTY` | Si el universo queda vacío, cae al parte del día. |
| `INCLUIR_SACRIFICIO_EMERGENCIA` | Incluye sacrificios del puesto de emergencia. |
| `RESUMEN_SOLO_PARTE_DIA` | Limita el resumen a productos con parte del día. |
| `RESUMEN_RECODIFICAR_ASUR_PENDIENTE_A_COCIDOS` | En resumen, recodifica Asurcarnes pendiente a cocidos. |
| `USE_LOCAL_PLAN_FILES` | Habilita archivos locales `PlanFaena*.xls`. |
| `USE_LOCAL_RETIRO_FILES` | Habilita archivos locales `RETIRO*.xlsm`. |

La configuración de sacrificio de emergencia se completa con:

- `SACRIFICIO_EMERGENCIA_PUESTO_TABLA`;
- `SACRIFICIO_EMERGENCIA_PUESTO_COLUMNAS`;
- `SACRIFICIO_EMERGENCIA_PUESTO_ILIKE`.

Algunas variables avanzadas se usan en código aunque no aparezcan todas en `.env.example`. Consulte también `services/librillos.service.js`, `services/librillos/cache-store.js` y `config/db.js`.

### Analítica

`ANALYTICS_ADMIN_KEY` protege la consulta de resumen administrativo. Si está vacía, el endpoint solo admite solicitudes locales. Defina una clave larga y aleatoria en despliegues compartidos. La autenticación se realiza con la cabecera `X-Analytics-Key`, no con un query param.

## Base de datos y persistencia

La aplicación consulta información existente en los esquemas de trazabilidad y organizaciones de Colbeef. Además, puede crear estructuras propias para salidas, auditoría y analítica.

### Fuentes externas requeridas

El rol de PostgreSQL necesita al menos `SELECT` sobre tablas como:

- `trazabilidad_proceso.plan_faena`
- `trazabilidad_proceso.plan_faena_producto`
- `trazabilidad_proceso.parte_producto`
- `trazabilidad_proceso.insensibilizacion`
- `trazabilidad_proceso.producto`
- `trazabilidad_proceso.parte_producto_empresa`
- `trazabilidad_proceso.parte_producto_empresa_local`
- `trazabilidad_proceso.parte_producto_cava_riel`
- `organizaciones.empresa`
- `organizaciones.sucursal`
- `sai.decomiso`
- `desposte.guia_desposte` y tablas de detalle asociadas

Algunas consultas también usan esquemas históricos `a_trazabilidad_proceso.*`. El código trabaja sobre tablas base y evita depender de vistas tipo `vw_pbi01`.

### `colbeef.salidas_cava`

Registra un movimiento de despacho por `id_producto`, incluyendo fecha de salida, usuario de registro y datos de edición. El esquema está en `sql/colbeef_salidas_cava.sql`.

### `app_auditoria_cambios`

Registra módulo, acción, entidad, usuario, valores anteriores/posteriores y metadatos JSON. El esquema está en `sql/app_auditoria_cambios.sql`.

### `app_analytics_events`

Tabla de eventos de uso. Si hay permisos DDL, la aplicación puede crearla automáticamente desde `services/analytics.service.js`. Si la base es de solo lectura, cae a `data/analytics-events.json`.

### Persistencia local opcional

Cuando se usan archivos, también pueden crearse:

- `data/salidas.json`
- `data/historico-cambios.json`
- `data/analytics-events.json`
- `data/crudas-sucursal.json`
- snapshots en `data/plan-faena-historico/`

Si PostgreSQL es una réplica de solo lectura, configure `SALIDAS_USE_FILE=1` y/o `AUDITORIA_USE_FILE=1`.

### Migración desde JSON

Si ya existen datos locales, ejecute:

```bash
npm run migrate:salidas
npm run migrate:auditoria
```

Realice un respaldo antes de cualquier migración y verifique primero que las tablas de destino existan.

Nota: los scripts de esquema/migración pueden forzar `ssl: false`. Contra un PostgreSQL remoto que exija SSL, prefiera aplicar el SQL manualmente o adaptar el script.

## Ejecución

### Iniciar el servidor

```bash
npm start
```

El servidor escucha en todas las interfaces (`0.0.0.0`) y publica:

- aplicación principal: `http://localhost:<PORT>/`;
- dashboard ejecutivo: `http://localhost:<PORT>/dashboard-ejecutivo-librillos.html`;
- estado técnico: `http://localhost:<PORT>/api/health`.

Para otro equipo de la red, reemplace `localhost` por la IP o el host del servidor.

### Comprobar el estado

```bash
curl http://localhost:8080/api/health
```

Una respuesta con `ok: true` y `db: "up"` confirma que el servidor puede consultar PostgreSQL.

El puerto por defecto del código es `3001` si `PORT` no está definido. `.env.example` propone `8080`.

## Despliegue en Windows / LAN

El repositorio incluye scripts BAT para operación en red local:

| Script | Uso |
| --- | --- |
| `scripts/instalar-en-equipo-nuevo.bat` | Asistente de instalación en un equipo nuevo. |
| `scripts/iniciar-colbeef-lan.bat` | Arranque manual del servicio en LAN. |
| `scripts/detener-colbeef-lan.bat` | Detiene el proceso en LAN. |
| `scripts/activar-autoarranque-colbeef.bat` | Crea tarea programada de autoarranque. |
| `scripts/desactivar-autoarranque-colbeef.bat` | Elimina el autoarranque. |
| `scripts/instalar-servicio-colbeef.bat` | Instala el servicio Windows con NSSM. |
| `scripts/desinstalar-servicio-colbeef.bat` | Desinstala el servicio Windows. |

Para el servicio NSSM:

1. Coloque `nssm.exe` en `tools/nssm.exe`.
2. Configure `.env` con `PORT` y, si aplica, `OFFICIAL_HOST`.
3. Ejecute `scripts/instalar-servicio-colbeef.bat` como administrador.
4. Revise los logs en `logs/`.

No hay Dockerfile, Compose, PM2 ni unidad systemd incluidos. En Linux el despliegue típico es `npm ci`, configurar `.env` y ejecutar `npm start` bajo un supervisor propio.

CI: `.github/workflows/ci.yml` ejecuta `npm ci` y `npm test` con Node 20 en Ubuntu.

## Flujo operativo

1. Seleccionar la fecha del turno.
2. Revisar **Turno / Detalle** (plan, parte e indicadores).
3. Gestionar pendientes y despachos en **Etiqueta cruda**.
4. Confirmar clientes, plazas y agrupaciones en **Por cliente**.
5. Revisar el **Resumen del día** y las diferencias.
6. Generar reportes, reporte mensual, etiquetas o guías.
7. Consultar **Histórico cambios** ante correcciones o reimpresiones.

Consulte `MANUAL-DE-USUARIO-COLBEEF.md` para instrucciones orientadas al usuario final. Algunas etiquetas del manual pueden diferir de la UI actual.

## API REST

Las fechas usan el formato `YYYY-MM-DD`.

### Estado

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/health` | Estado de BD, caché y proceso. |

### Librillos y operación

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/librillos?fecha=YYYY-MM-DD` | Datos de una fecha; sin parámetros usa el turno actual. |
| `GET` | `/api/librillos?desde=...&hasta=...` | Datos de un rango. |
| `GET` | `/api/librillos/resumen?fecha=...` | Resumen macro estricto. |
| `GET` | `/api/librillos/validacion?fecha=...` | Cuadre de movimientos y despachos. |
| `GET` | `/api/librillos/diagnostico?fecha=...` | Desglose operativo del día. |
| `GET` | `/api/librillos/auditoria-clasificacion?fecha=...` | Explicación de clasificación. |
| `GET` | `/api/librillos/observaciones?fecha=...` | Observaciones del plan/parte. |
| `GET` | `/api/librillos/universo-meta?fecha=...` | Meta del plan frente a insensibilización. |
| `GET` | `/api/librillos/plan-sin-insensibilizar?fecha=...` | Productos activos del plan sin insensibilizar. |
| `GET` | `/api/librillos/reporte-mensual?anio=YYYY&mes=1-12` | Reporte mensual; admite `refresh=1`. |
| `GET` | `/api/librillos/stats` | Producción de los últimos siete días. |
| `GET` | `/api/librillos/estado` | Estado resumido del caché. |
| `GET` | `/api/librillos/config` | Configuración operativa pública del backend. |
| `GET` | `/api/librillos/crudas-cambio-sucursal?fecha=...` | Cambios frente al día anterior. |
| `GET` | `/api/librillos/cambios-sucursal-revision?fecha_plan=...&fecha_revision=...` | Cruce entre plan y revisión. |
| `GET` | `/api/librillos/crudas-retenidas-etiqueta?fecha_plan=...&fecha_despacho=...` | Crudas retenidas para etiqueta. |
| `GET` | `/api/librillos/crudas-sucursal-guardadas` | Sucursales persistidas para crudas. |

### Salidas de cava

| Método | Ruta | Cuerpo/uso |
| --- | --- | --- |
| `GET` | `/api/salidas` | Lista las salidas registradas. |
| `POST` | `/api/salidas` | `{ "ids_productos": ["123", "456"] }` |
| `PUT` | `/api/salidas/:id` | `{ "fecha_salida": "2026-07-16T15:00:00Z" }` |
| `DELETE` | `/api/salidas/:id` | `{ "rol": "admin" }` |

### Dashboard, guías y auditoría

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/dashboard/resumen?fecha=...` | Resumen operativo/ejecutivo. |
| `GET` | `/api/dashboard/cierre?fecha=...` | Datos de cierre. |

Las rutas `/api/dashboard/*` existen en el backend; el tablero gerencial HTML usa principalmente `/api/librillos/*` y puede no consumirlas todas.
| `GET` | `/api/guias/verificar?fecha=...&categoria=...` | Verifica fuentes de una guía. |
| `GET` | `/api/guias/generar?fecha=...&categoria=...` | Genera los datos de una guía. |
| `GET` | `/api/guias/:codigo` | Consulta una guía por código. |
| `GET` | `/api/auditoria/cambios` | Histórico filtrable por fechas, módulo, acción, entidad y usuario. |
| `GET` | `/api/auditoria/reimpresion-crudas` | Consulta reimpresiones por `fecha_plan` y `fecha_revision`. |
| `POST` | `/api/auditoria/reimpresion-crudas` | Registra los elementos reimpresos. |

Categorías habituales de guía: `cat`, `derivados` y `global_hides` (también aceptan alias internos). Solo incluyen productos despachados en el turno.

### Analítica

| Método | Ruta | Uso |
| --- | --- | --- |
| `POST` | `/api/analytics/event` | Registra un evento de uso (`sessionId`, `eventName`). |
| `GET` | `/api/analytics/resumen-admin?desde=...&hasta=...` | Resumen administrativo protegido. |

### Cabeceras

- `X-Colbeef-Usuario`: identifica al usuario en operaciones de escritura. También puede enviarse `usuario` en el cuerpo.
- `X-Request-Id`: permite correlacionar una solicitud con los logs. Si no se envía, el servidor genera un UUID y lo devuelve en la respuesta.
- `X-Analytics-Key`: autoriza `GET /api/analytics/resumen-admin` cuando `ANALYTICS_ADMIN_KEY` está definida.

Ejemplo:

```bash
curl -X POST http://localhost:8080/api/salidas \
  -H "Content-Type: application/json" \
  -H "X-Colbeef-Usuario: operador.cava" \
  -d "{\"ids_productos\":[\"12345\"]}"
```

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm start` | Inicia Express y el polling del caché. |
| `npm test` | Ejecuta las pruebas unitarias. |
| `npm run verify` | Verifica variables y conexión PostgreSQL. |
| `npm run db:salidas-schema` | Crea el esquema de salidas. |
| `npm run db:auditoria-schema` | Crea la tabla de auditoría. |
| `npm run migrate:salidas` | Migra salidas JSON a PostgreSQL. |
| `npm run migrate:auditoria` | Migra auditoría JSON a PostgreSQL. |
| `npm run cuenta:crudas` | Ejecuta el conteo auxiliar de crudas del resumen macro. |

También existen utilidades en `scripts/` para verificar sacrificio de emergencia, incrustar recursos, instalar el servicio Windows y procesar archivos locales.

## Pruebas

Ejecute:

```bash
npm test
```

En Windows, el patrón `test/**/*.test.js` de `package.json` puede no expandirse. Use:

```powershell
node --test test
```

Las pruebas cubren:

- clasificación de movimientos y agrupaciones;
- ajustes de clasificación;
- parser de observaciones;
- resumen macro y resumen por sexo;
- plan e insensibilización;
- reporte mensual.

Resultado verificado localmente: 22 pruebas aprobadas. Son unitarias; no cubren controladores, frontend ni PostgreSQL real. La conexión a BD se comprueba con `npm run verify`.

## Seguridad y consideraciones de despliegue

La aplicación está diseñada principalmente para una **red interna controlada**. En su estado actual:

- no implementa inicio de sesión ni autorización robusta;
- el usuario informado en `X-Colbeef-Usuario` es declarativo;
- la eliminación de salidas valida un valor `rol: "admin"` enviado por el cliente;
- CORS está habilitado de forma general;
- el rate limit de escrituras se almacena en memoria y se reinicia con el proceso;
- el servidor publica HTTP, no HTTPS.

Por lo tanto, no debe exponerse directamente a Internet. Para un despliegue productivo:

1. ubique el servicio detrás de VPN, firewall o proxy inverso;
2. agregue autenticación centralizada si habrá usuarios no confiables;
3. termine TLS/HTTPS en el proxy;
4. restrinja CORS a los orígenes autorizados;
5. use un usuario PostgreSQL con privilegios mínimos;
6. configure una clave fuerte para `ANALYTICS_ADMIN_KEY`;
7. proteja `.env`, los respaldos y los archivos de `data/`;
8. supervise `/api/health` y los logs del proceso.

## Solución de problemas

### No conecta a PostgreSQL

- Ejecute `npm run verify`.
- Revise `POSTGRES_HOST`, `POSTGRES_PORT`, base, usuario y contraseña.
- Confirme VPN, firewall y reglas de acceso de PostgreSQL.
- Ajuste `POSTGRES_SSL` según el servidor.
- Para redes lentas, aumente `PG_CONNECT_TIMEOUT_MS`.

### El sistema abre, pero no muestra datos

- Confirme la fecha seleccionada.
- Consulte `/api/health`.
- Revise que el usuario de BD tenga acceso a las tablas de trazabilidad.
- Compruebe `ID_TIPO_PARTE_COLBEEF` y el corte operativo.
- Active temporalmente `COLBEEF_DEBUG=1` para diagnóstico.

### El resumen o el reporte queda bloqueado

La interfaz exige el resumen macro del backend para evitar cierres inconsistentes. Compruebe:

- `/api/librillos/resumen?fecha=YYYY-MM-DD`;
- conectividad con la base;
- logs del servidor;
- reglas de clasificación y universo diario.

### Los despachos no se guardan

- Con `SALIDAS_USE_FILE=1`, verifique permisos de escritura en `data/`.
- Con `SALIDAS_USE_FILE=0`, cree `colbeef.salidas_cava`.
- Revise la respuesta HTTP y el `X-Request-Id`.

### Los cambios no aparecen en el navegador

Actualice la página sin caché (`Ctrl+F5`). El servidor ya envía `no-store` para HTML, CSS y JavaScript, pero un proxy intermedio puede conservar archivos antiguos.

### Faltan gráficos, PDF o fuentes

Verifique el acceso a Internet para los recursos CDN y la presencia de los archivos requeridos en `frontend/vendor/`. Para una instalación sin Internet, descargue y sirva localmente todas las dependencias del navegador. Si faltan logo o plugins locales, revise `frontend/vendor/`, `frontend/assets/` y `scripts/embed-logo.mjs`.

### El servicio NSSM no se instala

Confirme que existe `tools/nssm.exe`, que Node está en la ruta esperada por el script y que la instalación se ejecuta como administrador.

### Archivos locales de plan o retiro no cargan

`USE_LOCAL_RETIRO_FILES=1` requiere Python y archivos `RETIRO*.xlsm` en `data/`. `USE_LOCAL_PLAN_FILES` depende de utilidades auxiliares y no debe habilitarse si esos scripts o archivos no están disponibles.

## Documentación relacionada

- `MANUAL-DE-USUARIO-COLBEEF.md`: guía de operación para usuarios finales.
- `.env.example`: referencia actual de variables de entorno.
- `sql/`: definición de tablas propias.
- `scripts/`: instalación Windows, migraciones y utilidades.
- `test/`: ejemplos ejecutables de las reglas de negocio.
- `.github/workflows/ci.yml`: pipeline de pruebas en Node 20.
