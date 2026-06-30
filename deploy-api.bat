@echo off
chcp 65001 >nul
title Daiyujin Precision Tools — One-Click Setup
setlocal enabledelayedexpansion

:: Run as admin check — winget needs it for some packages
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo This setup needs administrator privileges to install software.
    echo Right-click this file and choose "Run as administrator".
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║     Daiyujin Precision Tools · One-Click Setup      ║
echo  ║                                                    ║
echo  ║  This will install everything automatically.        ║
echo  ║  Keep this window open — it may take 15-30 minutes. ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: ── Step 1: Install Python ──────────────────────────
echo.
echo  [1/5] Installing Python...
winget install Python.Python.3.11 --accept-source-agreements --accept-package-agreements --silent 2>nul
if %errorlevel% neq 0 (
    winget install Python.Python.3.12 --accept-source-agreements --accept-package-agreements --silent 2>nul
)

:: Refresh PATH so Python becomes available in this session
call :refresh_path
echo         Done.

:: ── Step 2: Install Git ────────────────────────────
echo.
echo  [2/5] Installing Git...
winget install Git.Git --accept-source-agreements --accept-package-agreements --silent 2>nul
call :refresh_path
echo         Done.

:: ── Step 3: Install Miniconda ──────────────────────
echo.
echo  [3/5] Installing Miniconda...
winget install Anaconda.Miniconda3 --accept-source-agreements --accept-package-agreements --silent 2>nul
echo         Done.

:: Find conda
set "CONDA=%USERPROFILE%\miniconda3\Scripts\conda.exe"
if not exist "%CONDA%" set "CONDA=%USERPROFILE%\anaconda3\Scripts\conda.exe"
if not exist "%CONDA%" set "CONDA=%LOCALAPPDATA%\miniconda3\Scripts\conda.exe"
if not exist "%CONDA%" (
    echo         WARNING: conda not found. Trying %ProgramData%\miniconda3...
    set "CONDA=%ProgramData%\miniconda3\Scripts\conda.exe"
)
echo         Conda at: !CONDA!

:: ── Step 4: Create OCC environment ─────────────────
echo.
echo  [4/5] Setting up 3D engine (OCC)... this takes a few minutes...
call "%CONDA%" create -n occ python=3.11 -y
call "%CONDA%" install -n occ -c conda-forge pythonocc-core -y
echo         Done.

:: Find OCC python
set "OCC_PYTHON=%USERPROFILE%\miniconda3\envs\occ\python.exe"
if not exist "!OCC_PYTHON!" set "OCC_PYTHON=%USERPROFILE%\anaconda3\envs\occ\python.exe"
if not exist "!OCC_PYTHON!" set "OCC_PYTHON=%LOCALAPPDATA%\miniconda3\envs\occ\python.exe"
if not exist "!OCC_PYTHON!" set "OCC_PYTHON=%ProgramData%\miniconda3\envs\occ\python.exe"

:: ── Step 5: Download project & install deps ────────
echo.
echo  [5/5] Downloading project and installing dependencies...

set "PROJECT_DIR=%USERPROFILE%\daiyujin-precision-tools"

if exist "%PROJECT_DIR%\.git" (
    cd /d "%PROJECT_DIR%"
    git pull
) else (
    git clone https://github.com/YOUR_USERNAME/daiyujinweb.git "%PROJECT_DIR%"
)

cd /d "%PROJECT_DIR%"

:: Install Python packages
python -m pip install Flask Flask-Cors SQLAlchemy openpyxl waitress werkzeug --quiet

:: Write OCC path so Flask finds it
echo OCC_PYTHON=!OCC_PYTHON!> "%PROJECT_DIR%\backend\.env"

:: Init database
python "%PROJECT_DIR%\backend\scripts\init_db.py"
python "%PROJECT_DIR%\backend\scripts\seed_data.py"
python "%PROJECT_DIR%\backend\scripts\import_freight_rates.py"

:: ── Create desktop shortcut ────────────────────────
echo.
echo  Creating desktop shortcuts...

set "DESKTOP=%USERPROFILE%\Desktop"

:: Start API shortcut
echo @echo off > "%DESKTOP%\Start Daiyujin API.bat"
echo cd /d "%PROJECT_DIR%\backend" >> "%DESKTOP%\Start Daiyujin API.bat"
echo set ALLOWED_ORIGINS=https://gcnov.com,https://mfg-solution.com,https://www.mfg-solution.com >> "%DESKTOP%\Start Daiyujin API.bat"
echo python app.py >> "%DESKTOP%\Start Daiyujin API.bat"
echo pause >> "%DESKTOP%\Start Daiyujin API.bat"

:: ── Done ───────────────────────────────────────────
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║                                                      ║
echo  ║   Setup complete!                                    ║
echo  ║                                                      ║
echo  ║   On the desktop you'll find:                        ║
echo  ║     "Start Daiyujin API"  — double-click to launch   ║
echo  ║                                                      ║
echo  ║   Cloudflare Tunnel (run once):                      ║
echo  ║     winget install Cloudflare.cloudflared            ║
echo  ║     cloudflared tunnel login                         ║
echo  ║     cloudflared tunnel create gcnov-api              ║
echo  ║     cloudflared tunnel route dns gcnov-api api.xxx   ║
echo  ║     cloudflared tunnel run gcnov-api                 ║
echo  ║                                                      ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  You can close this window now.
pause
exit /b 0

:: ── Helper ─────────────────────────────────────────
:refresh_path
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul ^| find "PATH"') do set "SysPath=%%b"
    for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul ^| find "PATH"') do set "UserPath=%%b"
    set "PATH=%SysPath%;%UserPath%;%PATH%"
exit /b
