@echo off
setlocal
cd /d "%~dp0"

set "MSG=%~1"
if "%MSG%"=="" (
    set "MSG=Framework update %date% %time%"
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Publish-Framework-Update.ps1" -Message "%MSG%"
pause
