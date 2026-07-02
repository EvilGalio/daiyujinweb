@echo off
chcp 65001 >nul
title Daiyujin Admin Console
setlocal

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

set "PYTHON_EXE="

if exist "%PROJECT_ROOT%.venv\Scripts\python.exe" set "PYTHON_EXE=%PROJECT_ROOT%.venv\Scripts\python.exe"
if not defined PYTHON_EXE if exist "%USERPROFILE%\miniconda3\envs\occ\python.exe" set "PYTHON_EXE=%USERPROFILE%\miniconda3\envs\occ\python.exe"
if not defined PYTHON_EXE if exist "%USERPROFILE%\miniconda3\python.exe" set "PYTHON_EXE=%USERPROFILE%\miniconda3\python.exe"
if not defined PYTHON_EXE if exist "%USERPROFILE%\anaconda3\envs\occ\python.exe" set "PYTHON_EXE=%USERPROFILE%\anaconda3\envs\occ\python.exe"
if not defined PYTHON_EXE if exist "%USERPROFILE%\anaconda3\python.exe" set "PYTHON_EXE=%USERPROFILE%\anaconda3\python.exe"
if not defined PYTHON_EXE if exist "D:\anaconda\python.exe" set "PYTHON_EXE=D:\anaconda\python.exe"

if not defined PYTHON_EXE (
    echo Python was not found.
    echo Please install Miniconda/Python, or edit this script and set PYTHON_EXE manually.
    pause
    exit /b 1
)

echo Project root: %PROJECT_ROOT%
echo Python: %PYTHON_EXE%

for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:5010" ^| findstr "LISTENING"') do (
    echo Killing old process %%a on port 5010...
    taskkill /F /PID %%a 2>nul
)

timeout /t 1 /nobreak >nul

echo Starting Admin Console...
echo Open http://127.0.0.1:5010/admin in your browser
"%PYTHON_EXE%" -B backend\admin_app.py

pause
