Set-Location "D:\myfirstgithubcode\daiyujinweb\backend"

$env:DATABASE_URL = "sqlite:///D:/myfirstgithubcode/daiyujinweb/backend/data/daiyujin.db"
$env:OCC_PYTHON = "D:\anaconda\envs\occ\python.exe"
$env:ALLOWED_ORIGINS = "https://daiyujin.dpdns.org"

& "D:\anaconda\python.exe" -m waitress --listen=127.0.0.1:5000 app:app
