@echo off
setlocal
pushd "%~dp0"
title CubeBricks Installer Builder

echo ========================================
echo   CubeBricks - Windows Installer Builder
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js and try again.
  goto :failed
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js and try again.
  goto :failed
)

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "CUBEBRICKS_BASE_VERSION=%%V"
if not defined CUBEBRICKS_BASE_VERSION goto :failed
set "CUBEBRICKS_DEFAULT_VERSION=%CUBEBRICKS_BASE_VERSION%"
echo %CUBEBRICKS_BASE_VERSION%| findstr /c:"-" >nul
if errorlevel 1 set "CUBEBRICKS_DEFAULT_VERSION=%CUBEBRICKS_BASE_VERSION%-beta"
echo Enter the installer version, including its release label if needed.
echo Examples: 0.1.0-beta, 0.1.0-rc.1, 0.1.0
set "CUBEBRICKS_INSTALLER_VERSION="
set /p "CUBEBRICKS_INSTALLER_VERSION=Version [%CUBEBRICKS_DEFAULT_VERSION%]: "
if not defined CUBEBRICKS_INSTALLER_VERSION set "CUBEBRICKS_INSTALLER_VERSION=%CUBEBRICKS_DEFAULT_VERSION%"
node scripts\installer-version.cjs
if errorlevel 1 goto :failed
echo.

if not exist "node_modules\.bin\electron-builder.cmd" (
  echo [1/4] Installing build dependencies...
  call npm install
  if errorlevel 1 goto :failed
) else (
  echo [1/4] Build dependencies are ready.
)

echo [2/4] Checking source files...
call npm run check
if errorlevel 1 goto :failed

echo [3/4] Running model and render tests...
call npm run test:model
if errorlevel 1 goto :failed
call npm run test:render
if errorlevel 1 goto :failed

echo [4/4] Building the Windows installer...
call npm run dist:installer
if errorlevel 1 goto :failed

echo.
echo [DONE] The installer is in:
echo        %~dp0dist
echo.
start "" "%~dp0dist"
popd
pause
exit /b 0

:failed
echo.
echo [FAILED] Packaging stopped. Review the error above.
popd
pause
exit /b 1
