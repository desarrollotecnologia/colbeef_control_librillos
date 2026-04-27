@echo off
setlocal EnableExtensions

set "SERVICE_NAME=Colbeef"

pushd "%~dp0.."
set "APP_DIR=%CD%"
popd
set "NSSM=%APP_DIR%\tools\nssm.exe"

if not exist "%NSSM%" (
  echo [ERROR] No se encuentra NSSM en: %NSSM%
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

echo Deteniendo y eliminando el servicio %SERVICE_NAME%...
"%NSSM%" stop "%SERVICE_NAME%" >nul 2>&1
"%NSSM%" remove "%SERVICE_NAME%" confirm
if errorlevel 1 (
  sc delete "%SERVICE_NAME%" >nul 2>&1
)

echo.
echo Servicio %SERVICE_NAME% desinstalado.
pause
exit /b 0
