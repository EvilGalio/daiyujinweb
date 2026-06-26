@echo off
setlocal
title Cloudflare Tunnel - Daiyujin API

cd /d D:\myfirstgithubcode\daiyujinweb

for /f "usebackq delims=" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=(Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared' -ErrorAction Stop).ImagePath; if ($p -match '^(?<exe>.+?cloudflared\.exe)\s+tunnel\s+run\s+--token\s+(?<token>\S+)') { Write-Output ('CF_EXE=' + $Matches.exe); Write-Output ('CF_TOKEN=' + $Matches.token) }"`) do set "%%A"

if not defined CF_TOKEN (
    echo Could not read Cloudflare Tunnel token from the Windows service.
    echo Run "cloudflared service install ^<token^>" first, or reinstall the tunnel service.
    pause
    exit /b 1
)

if not exist "%CF_EXE%" (
    set "CF_EXE=cloudflared"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5000/api/health' -TimeoutSec 5 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
    echo Local API is not responding at http://127.0.0.1:5000/api/health
    echo Start start-api.bat first, then run this tunnel window again.
    pause
    exit /b 1
)

if "%~1"=="--dry-run" (
    echo Cloudflared executable: %CF_EXE%
    echo Token loaded: yes
    echo Local API health: ok
    exit /b 0
)

echo Starting Cloudflare Tunnel as current user...
echo Keep this window open while the public API is in use.
"%CF_EXE%" tunnel --loglevel info run --token "%CF_TOKEN%"
pause
