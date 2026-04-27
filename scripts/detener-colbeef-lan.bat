@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Autodetectar APP_DIR (carpeta padre de scripts/) y leer PORT del .env
pushd "%~dp0.."
set "APP_DIR=%CD%"
popd
set "APP_PORT=8080"
if exist "%APP_DIR%\.env" (
  for /f "usebackq tokens=1,2 delims==" %%A in ("%APP_DIR%\.env") do (
    if /I "%%A"=="PORT" set "APP_PORT=%%B"
  )
)
for /f "tokens=* delims= " %%X in ("%APP_PORT%") do set "APP_PORT=%%X"

echo Stopping Colbeef server on port %APP_PORT%...

set "PIDS="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%APP_PORT% .*LISTENING"') do (
  set "PIDS=!PIDS! %%p"
)

if "%PIDS%"=="" (
  echo No process is listening on %APP_PORT%.
  pause
  exit /b 0
)

for %%p in (%PIDS%) do (
  echo Ending PID %%p ...
  taskkill /PID %%p /F >nul 2>&1
)

echo Done.
pause
exit /b 0

