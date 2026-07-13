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
$RepairScript = Join-Path $PSScriptRoot "repair_allowed_extensions.py"

$script:ResolvedPython = ""
$script:PythonPrefix = @()

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
    if ($env:VIRTUAL_ENV) {
        $candidatePaths += Join-Path $env:VIRTUAL_ENV "Scripts\python.exe"
    }
    if ($env:CONDA_PREFIX) {
        $candidatePaths += Join-Path $env:CONDA_PREFIX "python.exe"
    }
    $candidatePaths += Join-Path $RepoRoot ".venv\Scripts\python.exe"
    $candidatePaths += Join-Path $BackendRoot ".venv\Scripts\python.exe"
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
        Write-Host "Installing ZIP, RAR, and 7Z support dependencies..."
        Invoke-SelectedPython -Arguments @(
            "-m", "pip", "install", "--disable-pip-version-check",
            "py7zr>=1.1.3,<2.0", "rarfile>=4.3,<5.0"
        )
    }

    Invoke-SelectedPython -Arguments @(
        "-B", "-c",
        "from importlib.metadata import version; print('py7zr=' + version('py7zr')); print('rarfile=' + version('rarfile'))"
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
