@echo off
title JUEGO VIPE - Servidor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   ERROR: No se encontro Node.js instalado.
  echo   Descargalo gratis en: https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Primera vez: instalando lo necesario...
  call npm install --no-audit --no-fund
)

echo.
echo   Arrancando JUEGO VIPE...
echo   El navegador se abrira solo en unos segundos.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://localhost:3000'"

node server.js

echo.
echo   El servidor se ha detenido.
pause
