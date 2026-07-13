[CmdletBinding()]
param(
    [string]$PythonExe = "",
    [string]$DatabaseUrl = "",
    [switch]$SkipDependencyInstall,
    [switch]$SkipBackup
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$BackendRoot = Join-Path $RepoRoot "backend"
$EnvFile = Join-Path $BackendRoot ".env"
$RepairScript = Join-Path $PSScriptRoot "repair_allowed_extensions.py"

$script:ResolvedPython = ""
$script:PythonPrefix = @()

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match "^\s*$Key\s*=\s*(.+?)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Use-PythonCandidate {
    param(
        [string]$Executable,
        [string[]]$Prefix = @()
    )

    if (-not $Executable) {
        return $false
    }
    try {
        $probeArgs = @($Prefix) + @("-c", "import sys; print(sys.executable)")
        $null = & $Executable @probeArgs 2>$null
        if ($LASTEXITCODE -eq 0) {
            $script:ResolvedPython = $Executable
            $script:PythonPrefix = @($Prefix)
            return $true
        }
    }
    catch {
        return $false
    }
    return $false
}

function Invoke-SelectedPython {
    param([string[]]$Arguments)

    $allArgs = @($script:PythonPrefix) + @($Arguments)
    & $script:ResolvedPython @allArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed with exit code $LASTEXITCODE."
    }
}

if ($PythonExe) {
    $explicitCommand = Get-Command $PythonExe -ErrorAction SilentlyContinue
    if (-not $explicitCommand -or -not (Use-PythonCandidate -Executable $explicitCommand.Source)) {
        throw "The supplied Python executable could not be used: $PythonExe"
    }
}
else {
    $candidatePaths = @()
    $configuredPython = Get-EnvValue -Path $EnvFile -Key "OCC_PYTHON"
    if ($configuredPython) {
        $candidatePaths += $configuredPython
    }
    if ($env:OCC_PYTHON) {
        $candidatePaths += $env:OCC_PYTHON
    }
    if ($env:VIRTUAL_ENV) {
        $candidatePaths += Join-Path $env:VIRTUAL_ENV "Scripts\python.exe"
    }
    if ($env:CONDA_PREFIX) {
        $candidatePaths += Join-Path $env:CONDA_PREFIX "python.exe"
    }
    $candidatePaths += Join-Path $RepoRoot ".venv\Scripts\python.exe"
    $candidatePaths += Join-Path $BackendRoot ".venv\Scripts\python.exe"
    $candidatePaths += Join-Path $env:USERPROFILE "miniconda3\envs\occ\python.exe"
    $candidatePaths += Join-Path $env:USERPROFILE "miniconda3\python.exe"
    $candidatePaths += Join-Path $env:USERPROFILE "anaconda3\envs\occ\python.exe"
    $candidatePaths += Join-Path $env:USERPROFILE "anaconda3\python.exe"
    $candidatePaths += "D:\anaconda\python.exe"

    foreach ($candidate in $candidatePaths) {
        if ((Test-Path -LiteralPath $candidate) -and (Use-PythonCandidate -Executable $candidate)) {
            break
        }
    }

    if (-not $script:ResolvedPython) {
        $pythonCommand = Get-Command "python.exe" -ErrorAction SilentlyContinue
        if ($pythonCommand) {
            $null = Use-PythonCandidate -Executable $pythonCommand.Source
        }
    }
    if (-not $script:ResolvedPython) {
        $pyCommand = Get-Command "py.exe" -ErrorAction SilentlyContinue
        if ($pyCommand) {
            $null = Use-PythonCandidate -Executable $pyCommand.Source -Prefix @("-3")
        }
    }
}

if (-not $script:ResolvedPython) {
    throw "No working Python 3 runtime was found. Pass -PythonExe with the service Python path."
}

Write-Host "Repo:     $RepoRoot"
Write-Host "Python:   $script:ResolvedPython"

Push-Location -LiteralPath $BackendRoot
try {
    if (-not $SkipDependencyInstall) {
        Write-Host "Installing archive migration dependencies..."
        Invoke-SelectedPython -Arguments @(
            "-m", "pip", "install", "--disable-pip-version-check",
            "SQLAlchemy>=2.0", "py7zr>=1.1.3,<2.0", "rarfile>=4.3,<5.0"
        )
    }

    Invoke-SelectedPython -Arguments @(
        "-B", "-c",
        "import sqlalchemy, py7zr, rarfile; from importlib.metadata import version; print('SQLAlchemy=' + version('SQLAlchemy')); print('py7zr=' + version('py7zr')); print('rarfile=' + version('rarfile'))"
    )

    $repairArgs = @("-B", $RepairScript)
    if ($DatabaseUrl) {
        $repairArgs += @("--database-url", $DatabaseUrl)
    }
    if ($SkipBackup) {
        $repairArgs += "--no-backup"
    }
    Invoke-SelectedPython -Arguments $repairArgs
}
finally {
    Pop-Location
}

$rarToolFound = $false
if ($env:RAR_EXTRACTION_TOOL -and (Test-Path -LiteralPath $env:RAR_EXTRACTION_TOOL)) {
    $rarToolFound = $true
}
foreach ($toolName in @("7z.exe", "unrar.exe", "unar.exe", "bsdtar.exe")) {
    if (Get-Command $toolName -ErrorAction SilentlyContinue) {
        $rarToolFound = $true
        break
    }
}
foreach ($toolPath in @("C:\Program Files\7-Zip\7z.exe", "C:\Program Files\WinRAR\UnRAR.exe")) {
    if (Test-Path -LiteralPath $toolPath) {
        $rarToolFound = $true
        break
    }
}
if (-not $rarToolFound) {
    Write-Warning "RAR uploads need 7-Zip, UnRAR, Unar, or bsdtar. Install one before enabling RAR in production."
}

Write-Host "PASS: Archive upload dependencies and database settings are ready."
Write-Host "Next: restart the backend service so the running process loads the new code and packages."
