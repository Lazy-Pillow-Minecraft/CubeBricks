@echo off
setlocal
pushd "%~dp0"
title CubeBricks Portable Builder

echo ========================================
echo   CubeBricks - Portable EXE Builder
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

echo [3/4] Running tests...
call npm run test:model
if errorlevel 1 goto :failed
call npm run test:render
if errorlevel 1 goto :failed
call npm run test:config
if errorlevel 1 goto :failed

echo [4/4] Building the portable executable...
call npm run dist:portable
if errorlevel 1 goto :failed

echo.
echo [DONE] The portable executable is in:
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
