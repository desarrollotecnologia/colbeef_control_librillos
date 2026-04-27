@echo off
setlocal EnableExtensions

set "TASK_NAME=Colbeef LAN AutoStart"

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

schtasks /Delete /TN "%TASK_NAME%" /F
if errorlevel 1 (
  echo Task was not found or could not be deleted.
  pause
  exit /b 1
)

echo.
echo Auto-start disabled successfully.
pause
exit /b 0

