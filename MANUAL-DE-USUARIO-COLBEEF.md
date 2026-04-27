# Manual de Usuario - Sistema Colbeef

## 1. Objetivo

Este manual explica el uso operativo del Sistema Colbeef para consultar, clasificar, controlar salidas y generar reportes diarios de librillos y crudas.

## 2. Alcance

Aplica para el uso de las vistas:

- Turno / Detalle
- Inventario
- Clientes
- Totales
- Reportes

Incluye exportacion de informacion en Excel, PDF e impresion.

## 3. Requisitos de uso

- Navegador web actualizado (Chrome, Edge o Firefox).
- Conexion a la red interna donde se encuentra el servidor.
- Backend y base de datos activos.
- Fecha de operacion seleccionada correctamente en la barra superior.

## 4. Ingreso al sistema

1. Abra el navegador.
2. Ingrese la URL del sistema Colbeef.
3. Verifique que en la parte superior aparezca la fecha de trabajo.
4. Si requiere otra fecha, cambiela en el selector y pulse **Actualizar**.

## 5. Estructura general de la interfaz

- **Menu lateral**: acceso a las vistas del sistema.
- **Barra superior**: fecha global y boton de actualizacion.
- **Area central**: tablas, indicadores y reportes de cada vista.

## 6. Vista Turno / Detalle

En esta vista se revisa la operacion del dia.

### 6.1 Indicadores principales

La barra superior muestra:

- Total librillos
- Total crudas
- Total general (librillos + crudas)

### 6.2 Tabla de historial

Permite revisar registros por:

- ID de producto
- Propietario
- Cliente destino
- Observacion
- Fechas de ingreso/salida

### 6.3 Acciones recomendadas

- Confirmar que la fecha seleccionada sea la correcta.
- Validar que los totales sean coherentes con el cierre del turno.
- Usar los filtros de tabla para busquedas puntuales.

## 7. Vista Inventario

Permite gestionar pendientes y despachos.

### 7.1 Funciones principales

- Ver pendientes por tipo (librillos / crudas).
- Seleccionar registros.
- Ejecutar despacho de seleccionados.
- Revisar despachados del dia.

### 7.2 Buenas practicas

- Confirmar IDs antes de despachar.
- Evitar despachos masivos sin verificacion.
- Revisar la seccion de "salio otro dia" para control de trazabilidad.

## 8. Vista Clientes

Presenta la informacion agrupada por cliente/propietario y plaza.

### 8.1 Uso recomendado

- Utilice el buscador para localizar clientes o IDs.
- Cambie entre subtabs de Librillos y Crudas para analisis rapido.
- Valide que la agrupacion comercial y la plaza correspondan al dia operativo.

## 9. Vista Totales

Muestra el resumen diario consolidado tipo macro.

### 9.1 Contenido del resumen

- Resumen de libros y chunchullas crudas.
- Cuadro de resumen de libros (Crudos, Cocidos, Derivados).
- Resumen de beneficio.

### 9.2 Regla de confiabilidad

El sistema trabaja en modo estricto con resumen macro desde backend.  
Si ese resumen no esta disponible, el sistema bloquea el reporte para evitar datos inconsistentes.

## 10. Vista Reportes

Permite generar reportes por agrupacion y por periodo.

### 10.1 Reporte por agrupacion

- Seleccionar agrupacion (o todas).
- Definir rango de fechas.
- Generar vista previa.

### 10.2 Exportacion

Desde la vista correspondiente puede:

- Descargar Excel
- Descargar PDF
- Imprimir

## 11. Procedimiento operativo diario sugerido

1. Seleccionar fecha del turno.
2. Revisar Turno / Detalle (totales y novedades).
3. Gestionar Inventario (pendientes y despachos).
4. Validar agrupaciones en Clientes.
5. Confirmar cierre en Totales.
6. Generar y exportar Reportes finales.

## 12. Errores frecuentes y solucion

### 12.1 "Sin datos para la fecha"

- Verifique la fecha seleccionada.
- Pulse **Actualizar**.
- Revise conectividad de base de datos.

### 12.2 Diferencias con macro

- Confirmar que se compara la misma fecha.
- Regenerar reporte tras actualizar.
- Verificar que el servidor este ejecutando la version actual.

### 12.3 Reporte no disponible por resumen macro

- Ocurre cuando no llega el resumen estricto del backend.
- Reintentar luego de actualizar.
- Validar estado del servidor y BD.

## 13. Control de cambios del manual

- Version: 1.0
- Sistema: Colbeef
- Estado: Vigente

