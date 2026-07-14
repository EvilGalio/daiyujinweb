@echo off
title Daiyujin API Server
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-api.ps1" %*
pause
