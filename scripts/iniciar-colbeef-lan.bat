@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem --------------------------------------------
rem Colbeef LAN starter
rem - Ensures firewall rules for 8080
rem - Starts server if not already listening
rem - Waits for health endpoint and opens browser
rem --------------------------------------------

set "APP_DIR=C:\laragon\www\colbeef"
set "APP_URL=http://192.168.20.137:8080"
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
netsh advfirewall firewall delete rule name="Colbeef 8080 LAN" >nul 2>&1
netsh advfirewall firewall delete rule name="Colbeef Node LAN" >nul 2>&1
netsh advfirewall firewall add rule name="Colbeef 8080 LAN" dir=in action=allow protocol=TCP localport=8080 profile=any >nul
netsh advfirewall firewall add rule name="Colbeef Node LAN" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes profile=any >nul

echo [3/5] Checking if server is already running on 8080...
netstat -ano | findstr /R /C:":8080 .*LISTENING" >nul
if not errorlevel 1 (
  echo Server already listening on 8080.
  goto wait_health
)

echo [4/5] Starting Colbeef server...
start "Colbeef Server" cmd /k "cd /d %APP_DIR% && npm start"

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

