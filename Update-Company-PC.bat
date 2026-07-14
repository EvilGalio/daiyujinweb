@echo off
setlocal
title Daiyujin Company PC Update
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Company-PC.ps1" %*
pause
