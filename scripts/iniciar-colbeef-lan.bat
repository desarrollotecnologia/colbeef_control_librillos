@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem --------------------------------------------
rem Colbeef LAN starter
rem - Ensures firewall rules for 8080
rem - Starts server if not already listening
rem - Waits for health endpoint and opens browser
rem --------------------------------------------

rem APP_DIR se autodetecta desde la ubicación de este .bat (carpeta padre de scripts/)
pushd "%~dp0.."
set "APP_DIR=%CD%"
popd

rem Leer PORT y OFFICIAL_HOST del .env (claves sin comentarios). Fallback a defaults.
set "APP_PORT=8080"
set "APP_HOST=127.0.0.1"
if exist "%APP_DIR%\.env" (
  for /f "usebackq tokens=1,2 delims==" %%A in ("%APP_DIR%\.env") do (
    if /I "%%A"=="PORT" set "APP_PORT=%%B"
    if /I "%%A"=="OFFICIAL_HOST" set "APP_HOST=%%B"
  )
)
rem Limpiar posibles espacios/CR
for /f "tokens=* delims= " %%X in ("%APP_PORT%") do set "APP_PORT=%%X"
for /f "tokens=* delims= " %%X in ("%APP_HOST%") do set "APP_HOST=%%X"

set "APP_URL=http://%APP_HOST%:%APP_PORT%"
set "HEALTH_URL=%APP_URL%/api/health"

rem Self-elevate to Admin for firewall setup (robust UAC prompt)
fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permissions...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c """"%~f0""""' -Verb RunAs -ErrorAction Stop; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo.
    echo Could not elevate automatically.
    echo Please right-click this file and choose: Run as administrator.
    pause
    exit /b 1
  )
  exit /b
)

echo [1/5] Setting network profile to Private when possible...
powershell -NoProfile -Command "try { Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private -ErrorAction Stop; Write-Host 'Network profile: Private'; } catch { Write-Host 'Could not change network profile (continuing)...'; }"

echo [2/5] Refreshing firewall rules...
netsh advfirewall firewall delete rule name="Colbeef %APP_PORT% LAN" >nul 2>&1
netsh advfirewall firewall delete rule name="Colbeef Node LAN" >nul 2>&1
netsh advfirewall firewall add rule name="Colbeef %APP_PORT% LAN" dir=in action=allow protocol=TCP localport=%APP_PORT% profile=any >nul
netsh advfirewall firewall add rule name="Colbeef Node LAN" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes profile=any >nul

echo [3/5] Checking if server is already running on %APP_PORT%...
netstat -ano | findstr /R /C:":%APP_PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo Server already listening on %APP_PORT%.
  goto wait_health
)

echo [4/5] Starting Colbeef server (APP_DIR=%APP_DIR%)...
start "Colbeef Server" /D "%APP_DIR%" cmd /k npm start

:wait_health
echo [5/5] Waiting for API health...
set /a retries=0
:health_loop
set /a retries+=1
powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing '%HEALTH_URL%' -TimeoutSec 3; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  if !retries! GEQ 25 (
    echo Could not validate %HEALTH_URL% after multiple attempts.
    echo You can still test manually: %APP_URL%
    pause
    exit /b 1
  )
  timeout /t 2 /nobreak >nul
  goto health_loop
)

echo Ready: %APP_URL%
start "" "%APP_URL%"
exit /b 0

