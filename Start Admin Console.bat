@echo off
title Daiyujin Admin Console
cd /d D:\myfirstgithubcode\daiyujinweb

:: Kill any existing process on port 5010
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:5010" ^| findstr "LISTENING"') do (
    echo Killing old process %%a on port 5010...
    taskkill /F /PID %%a 2>nul
)
timeout /t 1 /nobreak >nul

echo Starting Admin Console...
echo Open http://127.0.0.1:5010/admin in your browser
D:\anaconda\python.exe -B backend\admin_app.py
pause
