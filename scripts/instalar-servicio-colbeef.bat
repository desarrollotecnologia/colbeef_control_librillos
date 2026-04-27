@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem -----------------------------------------------------------
rem Instala/registra Colbeef como Servicio de Windows usando NSSM.
rem - Auto-arranque al boot (no requiere logon de usuario)
rem - Sin ventana visible, logs en logs\
rem - Reinicio automatico ante crash
rem - Auto-eleva con UAC si no es admin
rem -----------------------------------------------------------

set "SERVICE_NAME=Colbeef"
set "SERVICE_DESC=Colbeef Control de Librillos (Node/Express en :%APP_PORT%)"

rem Autodetectar APP_DIR (carpeta padre de scripts/)
pushd "%~dp0.."
set "APP_DIR=%CD%"
popd
set "NSSM=%APP_DIR%\tools\nssm.exe"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "APP_ENTRY=server.js"
set "LOG_DIR=%APP_DIR%\logs"
set "STDOUT_LOG=%LOG_DIR%\service-stdout.log"
set "STDERR_LOG=%LOG_DIR%\service-stderr.log"

rem Leer PORT del .env para mostrar URL al final
set "APP_PORT=8080"
set "APP_HOST=127.0.0.1"
if exist "%APP_DIR%\.env" (
  for /f "usebackq tokens=1,2 delims==" %%A in ("%APP_DIR%\.env") do (
    if /I "%%A"=="PORT" set "APP_PORT=%%B"
    if /I "%%A"=="OFFICIAL_HOST" set "APP_HOST=%%B"
  )
)
for /f "tokens=* delims= " %%X in ("%APP_PORT%") do set "APP_PORT=%%X"
for /f "tokens=* delims= " %%X in ("%APP_HOST%") do set "APP_HOST=%%X"

rem Validaciones previas
if not exist "%NSSM%" (
  echo [ERROR] No se encuentra NSSM en: %NSSM%
  echo Ejecuta primero la descarga de NSSM en tools\.
  pause
  exit /b 1
)
if not exist "%NODE_EXE%" (
  echo [ERROR] Node.exe no encontrado en: %NODE_EXE%
  echo Ajusta NODE_EXE en este script si Node esta instalado en otra ruta.
  pause
  exit /b 1
)
if not exist "%APP_DIR%\%APP_ENTRY%" (
  echo [ERROR] No existe %APP_DIR%\%APP_ENTRY%
  pause
  exit /b 1
)

rem Auto-elevarse con UAC si no es admin
fltmc >nul 2>&1
if errorlevel 1 (
  echo Solicitando permisos de Administrador...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c """"%~f0""""' -Verb RunAs -ErrorAction Stop; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo No se pudo elevar. Click derecho -^> Ejecutar como administrador.
    pause
    exit /b 1
  )
  exit /b
)

echo === Migracion Colbeef a Servicio de Windows ===
echo APP_DIR: %APP_DIR%
echo NSSM:    %NSSM%
echo NODE:    %NODE_EXE%
echo PUERTO:  %APP_PORT%
echo HOST:    %APP_HOST%
echo.

rem [1/7] Crear carpeta de logs
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

rem [2/7] Detener cualquier servidor corriendo en el puerto
echo [1/7] Deteniendo procesos node escuchando en puerto %APP_PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do (
  echo   - Matando PID %%p
  taskkill /PID %%p /F /T >nul 2>&1
)

rem [3/7] Desactivar tarea programada anterior (si existe) para evitar arranques duplicados
echo [2/7] Desactivando tarea programada antigua (si existe)...
schtasks /Change /TN "Colbeef LAN AutoStart" /DISABLE >nul 2>&1
if errorlevel 1 (
  echo   - No habia tarea programada o ya estaba desactivada.
) else (
  echo   - Tarea "Colbeef LAN AutoStart" desactivada.
)

rem [4/7] Si el servicio ya existe, detenerlo y borrarlo para reinstalar limpio
echo [3/7] Limpiando instalacion previa del servicio %SERVICE_NAME% (si existe)...
"%NSSM%" stop "%SERVICE_NAME%" >nul 2>&1
sc delete "%SERVICE_NAME%" >nul 2>&1
timeout /t 2 /nobreak >nul

rem [5/7] Reglas de firewall para el puerto y para Node
echo [4/7] Asegurando reglas de firewall...
netsh advfirewall firewall delete rule name="Colbeef %APP_PORT% LAN" >nul 2>&1
netsh advfirewall firewall delete rule name="Colbeef Node LAN" >nul 2>&1
netsh advfirewall firewall add rule name="Colbeef %APP_PORT% LAN" dir=in action=allow protocol=TCP localport=%APP_PORT% profile=any >nul
netsh advfirewall firewall add rule name="Colbeef Node LAN" dir=in action=allow program="%NODE_EXE%" enable=yes profile=any >nul

rem [6/7] Instalar y configurar el servicio con NSSM
echo [5/7] Instalando servicio %SERVICE_NAME% con NSSM...
"%NSSM%" install "%SERVICE_NAME%" "%NODE_EXE%" "%APP_ENTRY%"
if errorlevel 1 (
  echo [ERROR] No se pudo instalar el servicio con NSSM.
  pause
  exit /b 1
)

"%NSSM%" set "%SERVICE_NAME%" AppDirectory "%APP_DIR%"
"%NSSM%" set "%SERVICE_NAME%" DisplayName "Colbeef Control de Librillos"
"%NSSM%" set "%SERVICE_NAME%" Description  "Servidor Node/Express del sistema Colbeef. Puerto %APP_PORT%."
"%NSSM%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START
"%NSSM%" set "%SERVICE_NAME%" AppStdout "%STDOUT_LOG%"
"%NSSM%" set "%SERVICE_NAME%" AppStderr "%STDERR_LOG%"
"%NSSM%" set "%SERVICE_NAME%" AppRotateFiles 1
"%NSSM%" set "%SERVICE_NAME%" AppRotateOnline 1
"%NSSM%" set "%SERVICE_NAME%" AppRotateBytes 5242880
"%NSSM%" set "%SERVICE_NAME%" AppStdoutCreationDisposition 4
"%NSSM%" set "%SERVICE_NAME%" AppStderrCreationDisposition 4
"%NSSM%" set "%SERVICE_NAME%" AppExit Default Restart
"%NSSM%" set "%SERVICE_NAME%" AppRestartDelay 5000
"%NSSM%" set "%SERVICE_NAME%" AppThrottle 10000

echo.
echo [6/7] Iniciando servicio %SERVICE_NAME%...
"%NSSM%" start "%SERVICE_NAME%"

echo.
echo [7/7] Esperando a que el endpoint /api/health responda...
set /a retries=0
:health_loop
set /a retries+=1
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing 'http://%APP_HOST%:%APP_PORT%/api/health' -TimeoutSec 3; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  if !retries! GEQ 25 (
    echo.
    echo [WARN] No se pudo validar /api/health en %retries% intentos.
    echo Revisa los logs en: %LOG_DIR%
    pause
    exit /b 1
  )
  timeout /t 2 /nobreak >nul
  goto health_loop
)

echo.
echo ============================================================
echo  Servicio %SERVICE_NAME% instalado y corriendo correctamente.
echo  URL:    http://%APP_HOST%:%APP_PORT%
echo  Logs:   %LOG_DIR%
echo  Control:
echo    nssm start   %SERVICE_NAME%
echo    nssm stop    %SERVICE_NAME%
echo    nssm restart %SERVICE_NAME%
echo    services.msc  (interfaz grafica)
echo ============================================================
pause
exit /b 0
