@echo off
title Daiyujin API Server - DHL
cd /d D:\myfirstgithubcode\daiyujinweb

:: Kill any existing process on port 5000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:5000" ^| findstr "LISTENING"') do (
    echo Killing old process %%a on port 5000...
    taskkill /F /PID %%a 2>nul
)
timeout /t 1 /nobreak >nul

set ALLOWED_ORIGINS=https://gcnov.com,https://daiyujin.dpdns.org,http://daiyujin.dpdns.org,http://127.0.0.1:5500
D:\anaconda\python.exe -B backend\app.py
pause
