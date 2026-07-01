@echo off
title Daiyujin Exchange Rate Task Setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Exchange-Rate-Task.ps1"
pause
