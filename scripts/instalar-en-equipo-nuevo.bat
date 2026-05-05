@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

REM =================================================================
REM  Colbeef - Instalacion en equipo nuevo
REM  Clona el repo, instala dependencias, prepara .env y opcionalmente
REM  registra el servicio Windows con NSSM.
REM =================================================================

set "REPO_URL=https://github.com/desarrollotecnologia/colbeef_control_librillos.git"
set "DEFAULT_PARENT=C:\proyectos"
set "REPO_DIR_NAME=colbeef_control_librillos"

echo.
echo ============================================================
echo   COLBEEF - Instalacion en equipo nuevo
echo ============================================================
echo.

REM --- 1. Verificar prerequisitos ---
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git no esta instalado. Descargalo desde https://git-scm.com/download/win
  echo Cuando termine la instalacion vuelve a ejecutar este script.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado. Descargalo desde https://nodejs.org/  ^(LTS 18+^)
  echo Cuando termine la instalacion vuelve a ejecutar este script.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm no esta disponible en PATH. Reinstala Node.js o reinicia la terminal.
  pause
  exit /b 1
)

for /f "tokens=*" %%a in ('git --version') do set "GIT_VER=%%a"
for /f "tokens=*" %%a in ('node --version') do set "NODE_VER=%%a"
echo [OK] !GIT_VER!
echo [OK] Node !NODE_VER!
echo.

REM --- 2. Pedir carpeta de destino ---
set "TARGET_PARENT=%DEFAULT_PARENT%"
set /p "TARGET_PARENT=Carpeta padre donde clonar [%DEFAULT_PARENT%]: "
if "!TARGET_PARENT!"=="" set "TARGET_PARENT=%DEFAULT_PARENT%"

if not exist "!TARGET_PARENT!" (
  echo Creando carpeta !TARGET_PARENT! ...
  mkdir "!TARGET_PARENT!" 2>nul
  if errorlevel 1 (
    echo [ERROR] No se pudo crear !TARGET_PARENT!
    pause
    exit /b 1
  )
)

set "TARGET_DIR=!TARGET_PARENT!\!REPO_DIR_NAME!"

REM --- 3. Clonar o actualizar el repo ---
if exist "!TARGET_DIR!\.git" (
  echo.
  echo La carpeta !TARGET_DIR! ya tiene un repositorio git.
  echo Hacemos git pull para actualizarla...
  pushd "!TARGET_DIR!"
  git pull
  set "PULL_RC=!errorlevel!"
  popd
  if not "!PULL_RC!"=="0" (
    echo [ADVERTENCIA] git pull termino con codigo !PULL_RC!. Revisa manualmente.
  )
) else (
  if exist "!TARGET_DIR!" (
    echo.
    echo [ERROR] La carpeta !TARGET_DIR! ya existe pero no es un repo git.
    echo Borrala o elige otra carpeta y volve a correr el script.
    pause
    exit /b 1
  )
  echo.
  echo Clonando %REPO_URL%
  echo en !TARGET_DIR! ...
  git clone "%REPO_URL%" "!TARGET_DIR!"
  if errorlevel 1 (
    echo [ERROR] git clone fallo.
    pause
    exit /b 1
  )
)

REM --- 4. npm install ---
echo.
echo Instalando dependencias con npm install ...
pushd "!TARGET_DIR!"
call npm install
set "NPM_RC=!errorlevel!"
popd
if not "!NPM_RC!"=="0" (
  echo [ERROR] npm install fallo con codigo !NPM_RC!.
  pause
  exit /b 1
)

REM --- 5. Configurar .env ---
echo.
if exist "!TARGET_DIR!\.env" (
  echo [OK] Ya existe .env en el proyecto. No se sobrescribe.
) else (
  if exist "!TARGET_DIR!\.env.example" (
    copy /Y "!TARGET_DIR!\.env.example" "!TARGET_DIR!\.env" >nul
    echo Se creo .env a partir de .env.example
    echo.
    echo IMPORTANTE: edita los valores reales ^(POSTGRES_*, OFFICIAL_HOST, etc^).
    echo Voy a abrir el archivo en Notepad...
    start "" notepad "!TARGET_DIR!\.env"
    echo.
    echo Cuando termines de editar y GUARDES el .env, pulsa una tecla aqui para continuar.
    pause >nul
  ) else (
    echo [ADVERTENCIA] No hay .env.example en el repo. Tendras que crear .env a mano.
  )
)

REM --- 6. Verificacion opcional ---
echo.
set "RUN_VERIFY=S"
set /p "RUN_VERIFY=Quieres correr 'npm run verify' para chequear la conexion a la BD? [S/n]: "
if /i "!RUN_VERIFY!"=="S" (
  pushd "!TARGET_DIR!"
  call npm run verify
  popd
)

REM --- 7. Servicio Windows opcional ---
echo.
set "INSTALL_SVC=N"
set /p "INSTALL_SVC=Quieres instalarlo como servicio Windows con auto-arranque? [s/N]: "
if /i "!INSTALL_SVC!"=="S" (
  if exist "!TARGET_DIR!\scripts\instalar-servicio-colbeef.bat" (
    echo.
    echo Lanzando instalador del servicio. Aceptar el UAC cuando aparezca...
    pushd "!TARGET_DIR!\scripts"
    call instalar-servicio-colbeef.bat
    popd
  ) else (
    echo [ADVERTENCIA] No se encontro scripts\instalar-servicio-colbeef.bat
  )
) else (
  echo Saltando instalacion de servicio. Para iniciar manualmente: cd /d "!TARGET_DIR!"  ^&^&  npm start
)

echo.
echo ============================================================
echo   LISTO. Proyecto listo en !TARGET_DIR!
echo ============================================================
echo.
echo Para iniciarlo a mano:
echo   cd /d "!TARGET_DIR!"
echo   npm start
echo.
echo Para abrir en el navegador:
echo   http://localhost:8080
echo.
pause
endlocal
