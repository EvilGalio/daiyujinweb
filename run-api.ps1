$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$EnvFile = Join-Path $BackendRoot ".env"
$ApiPort = 5000

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
        throw "No OCC_PYTHON configured and python was not found on PATH. Create backend\.env with OCC_PYTHON=<path-to-occ-python.exe>."
    }
    $OccPython = $pythonCmd.Source
}

Set-Location $BackendRoot

$dbPath = (Join-Path $BackendRoot "data\daiyujin.db").Replace("\", "/")
$env:DATABASE_URL = "sqlite:///$dbPath"
$env:OCC_PYTHON = $OccPython
$env:ALLOWED_ORIGINS = "https://gcnov.com,https://mfg-solution.com,https://www.mfg-solution.com,https://gcindus.com,https://www.gcindus.com,https://daiyujin.dpdns.org,http://daiyujin.dpdns.org,http://127.0.0.1:5500"

# Load backend/.env for email/SMTP settings
$envFile = Join-Path $BackendRoot ".env"
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
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

& $OccPython -m waitress "--listen=127.0.0.1:$ApiPort" "--threads=16" "--channel-timeout=300" app:app
