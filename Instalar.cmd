@echo off
chcp 65001 >nul
title Instalar o Farol
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
set /p ABRIR="Abrir o Farol agora? (s/n) "
if /i "%ABRIR%"=="s" start "" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Farol.lnk"
