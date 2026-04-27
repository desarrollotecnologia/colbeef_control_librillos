@echo off
setlocal EnableExtensions

set "TASK_NAME=Colbeef LAN AutoStart"
rem APP_DIR se autodetecta desde la ubicación de este .bat (carpeta padre de scripts/)
pushd "%~dp0.."
set "APP_DIR=%CD%"
popd
set "STARTER_BAT=%APP_DIR%\scripts\iniciar-colbeef-lan.bat"

if not exist "%STARTER_BAT%" (
  echo File not found: "%STARTER_BAT%"
  pause
  exit /b 1
)

rem Require admin to register startup task
fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting Administrator permissions...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c """"%~f0""""' -Verb RunAs -ErrorAction Stop; exit 0 } catch { exit 1 }"
  if errorlevel 1 (
    echo Could not elevate. Run this file as Administrator.
    pause
    exit /b 1
  )
  exit /b
)

echo Creating startup task: %TASK_NAME%
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
schtasks /Create /TN "%TASK_NAME%" /TR "\"%STARTER_BAT%\"" /SC ONLOGON /RL HIGHEST /F
if errorlevel 1 (
  echo Failed to create scheduled task.
  pause
  exit /b 1
)

echo.
echo Auto-start enabled successfully.
echo Task: %TASK_NAME%
echo The server will start automatically at Windows logon.
pause
exit /b 0

