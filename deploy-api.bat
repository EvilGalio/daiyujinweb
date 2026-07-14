@echo off
setlocal
title Daiyujin Company PC Update
cd /d "%~dp0"

echo deploy-api.bat is deprecated because its old installer could overwrite backend\.env.
echo Delegating to the maintained Update-Company-PC.ps1 workflow.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Company-PC.ps1" %*
set "UPDATE_EXIT=%ERRORLEVEL%"
if not "%UPDATE_EXIT%"=="0" pause
exit /b %UPDATE_EXIT%
