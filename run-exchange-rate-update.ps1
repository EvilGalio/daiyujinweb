$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$EnvFile = Join-Path $BackendRoot ".env"
$LogPath = Join-Path $ProjectRoot "exchange-rate-update.log"

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*$Key\s*=\s*(.+)\s*$") {
            return $Matches[1].Trim()
        }
    }
    return $null
}

$OccPython = Get-EnvValue -Path $EnvFile -Key "OCC_PYTHON"
if ([string]::IsNullOrWhiteSpace($OccPython)) {
    $OccPython = $env:OCC_PYTHON
}

if ([string]::IsNullOrWhiteSpace($OccPython) -or -not (Test-Path -LiteralPath $OccPython)) {
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCmd) {
        throw "No OCC_PYTHON configured and python was not found on PATH. Create backend\.env with OCC_PYTHON=<path-to-python.exe>."
    }
    $OccPython = $pythonCmd.Source
}

$dbPath = (Join-Path $BackendRoot "data\daiyujin.db").Replace("\", "/")
$env:DATABASE_URL = "sqlite:///$dbPath"
$env:OCC_PYTHON = $OccPython

Set-Location -LiteralPath $BackendRoot
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -LiteralPath $LogPath -Value "[$stamp] Starting exchange-rate update"

& $OccPython "scripts\update_exchange_rates.py" *>&1 | Tee-Object -FilePath $LogPath -Append

if ($LASTEXITCODE -ne 0) {
    throw "Exchange-rate update failed with exit code $LASTEXITCODE. See $LogPath"
}
