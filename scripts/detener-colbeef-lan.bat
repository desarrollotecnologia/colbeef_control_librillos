@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo Stopping Colbeef server on port 8080...

set "PIDS="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8080 .*LISTENING"') do (
  set "PIDS=!PIDS! %%p"
)

if "%PIDS%"=="" (
  echo No process is listening on 8080.
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

