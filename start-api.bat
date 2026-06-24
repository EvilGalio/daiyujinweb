@echo off
title Daiyujin API Server
cd /d D:\myfirstgithubcode\daiyujinweb
set ALLOWED_ORIGINS=https://gcnov.com,https://daiyujin.dpdns.org,http://daiyujin.dpdns.org,http://127.0.0.1:5500
D:\anaconda\python.exe backend\app.py
pause
