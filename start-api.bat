@echo off
title Daiyujin API Server
cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:5000" ^| findstr "LISTENING"') do (
    echo Killing old process %%a on port 5000...
    taskkill /F /PID %%a 2>nul
)

timeout /t 1 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-api.ps1"
pause
