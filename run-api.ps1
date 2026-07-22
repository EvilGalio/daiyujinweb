[CmdletBinding()]
param(
    [string]$BackendPython = "",
    [string]$OccPython = "",
    [string]$RuntimeTempRoot = "",
    [int]$ApiPort = 5000
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$EnvFile = Join-Path $BackendRoot ".env"

function Import-EnvFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
            continue
        }
        $parts = $trimmed.Split("=", 2)
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($key -match '^[A-Za-z_][A-Za-z0-9_]*$') {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

function Resolve-PythonPath {
    param(
        [string]$RequestedPath,
        [string]$EnvironmentName,
        [string[]]$FallbackPaths,
        [string]$ProbeCode = ""
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $candidates += $RequestedPath
    }
    $configured = [Environment]::GetEnvironmentVariable($EnvironmentName, "Process")
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        $candidates += $configured
    }
    $candidates += $FallbackPaths

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $resolved = (Resolve-Path -LiteralPath $candidate).Path
            if ($ProbeCode) {
                & $resolved -B -c $ProbeCode 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    continue
                }
            }
            return $resolved
        }
    }

    throw "$EnvironmentName is not configured. Set an absolute Python path in backend\.env or pass the matching script parameter."
}

Import-EnvFile -Path $EnvFile

if (-not [string]::IsNullOrWhiteSpace($RuntimeTempRoot)) {
    $RuntimeTempRoot = [IO.Path]::GetFullPath($RuntimeTempRoot)
    if (-not (Test-Path -LiteralPath $RuntimeTempRoot -PathType Container)) {
        throw "Precision Tools API runtime temp directory was not prepared"
    }
    $env:TEMP = $RuntimeTempRoot
    $env:TMP = $RuntimeTempRoot
}

$commonPythonPaths = @(
    (Join-Path $ProjectRoot ".venv\Scripts\python.exe"),
    (Join-Path $BackendRoot ".venv\Scripts\python.exe"),
    (Join-Path $env:USERPROFILE "miniconda3\envs\occ\python.exe"),
    (Join-Path $env:USERPROFILE "anaconda3\envs\occ\python.exe"),
    (Join-Path $env:ProgramFiles "Python313\python.exe"),
    (Join-Path $env:ProgramFiles "Python312\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
    "D:\anaconda\envs\occ\python.exe",
    "D:\anaconda\python.exe"
)

$BackendPython = Resolve-PythonPath `
    -RequestedPath $BackendPython `
    -EnvironmentName "BACKEND_PYTHON" `
    -FallbackPaths $commonPythonPaths

$OccPython = Resolve-PythonPath `
    -RequestedPath $OccPython `
    -EnvironmentName "OCC_PYTHON" `
    -FallbackPaths (@($BackendPython) + $commonPythonPaths) `
    -ProbeCode "from OCC.Core.BRep import BRep_Tool"

$dbPath = (Join-Path $BackendRoot "data\daiyujin.db").Replace("\", "/")
$env:DATABASE_URL = "sqlite:///$dbPath"
$env:BACKEND_PYTHON = $BackendPython
$env:OCC_PYTHON = $OccPython
if ([string]::IsNullOrWhiteSpace($env:QUOTE_ASYNC_ARCHIVES_ENABLED)) {
    $env:QUOTE_ASYNC_ARCHIVES_ENABLED = "0"
}
if ([string]::IsNullOrWhiteSpace($env:QUOTE_CAD_CONCURRENCY)) {
    $env:QUOTE_CAD_CONCURRENCY = "2"
}
$env:ALLOWED_ORIGINS = "https://gcnov.com,https://mfg-solution.com,https://www.mfg-solution.com,https://gcindus.com,https://www.gcindus.com,https://daiyujin.dpdns.org,http://daiyujin.dpdns.org,http://127.0.0.1:5500"

Set-Location -LiteralPath $BackendRoot

& $BackendPython -B -c "import flask, sqlalchemy, waitress"
if ($LASTEXITCODE -ne 0) {
    throw "BACKEND_PYTHON cannot import the API dependencies. Run Update-Company-PC.ps1 to install backend\requirements.txt."
}

& $BackendPython -m waitress "--listen=127.0.0.1:$ApiPort" "--threads=16" "--channel-timeout=300" app:app
if ($LASTEXITCODE -ne 0) {
    throw "Waitress exited with code $LASTEXITCODE."
}
