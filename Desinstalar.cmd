@echo off
chcp 65001 >nul
title Desinstalar o Farol
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\uninstall.ps1"
pause
