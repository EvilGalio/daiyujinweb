@echo off
setlocal
title Daiyujin Quote Worker
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-quote-worker.ps1" %*
if errorlevel 1 pause
