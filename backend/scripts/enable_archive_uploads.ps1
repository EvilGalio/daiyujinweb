[CmdletBinding()]
param(
    [Alias("PythonExe")]
    [string]$BackendPythonExe = "",
    [string]$OccPythonExe = "",
    [string]$DatabaseUrl = "",
    [switch]$SkipDependencyInstall,
    [switch]$SkipBackup,
    [switch]$AllowMissingRarTool,
    [switch]$EnableAsyncArchives,
    [switch]$DisableAsyncArchives
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
$WorkerScript = Join-Path $PSScriptRoot "run_quote_worker.py"
$Requirements = Join-Path $BackendRoot "requirements.txt"

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*?)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Set-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value,
        [switch]$OnlyIfMissing
    )

    $lines = @()
    if (Test-Path -LiteralPath $Path) {
        $lines = @([System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8))
    }
    $pattern = "^\s*$([regex]::Escape($Key))\s*="
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $index = $i
            break
        }
    }
    if ($index -ge 0) {
        if ($OnlyIfMissing) {
            return
        }
        $lines[$index] = "$Key=$Value"
    }
    else {
        $lines += "$Key=$Value"
    }
    [System.IO.File]::WriteAllLines($Path, $lines, $Utf8NoBom)
}

function Resolve-PythonPath {
    param(
        [string]$RequestedPath,
        [string]$EnvironmentName,
        [string[]]$FallbackPaths,
        [string]$ProbeCode = ""
    )

    $candidates = @()
    if ($RequestedPath) {
        $candidates += $RequestedPath
    }
    $processValue = [Environment]::GetEnvironmentVariable($EnvironmentName, "Process")
    if ($processValue) {
        $candidates += $processValue
    }
    $fileValue = Get-EnvValue -Path $EnvFile -Key $EnvironmentName
    if ($fileValue) {
        $candidates += $fileValue
    }
    $candidates += $FallbackPaths

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
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
    throw "$EnvironmentName is not configured with a usable absolute path."
}

function Invoke-Python {
    param(
        [string]$Executable,
        [string[]]$Arguments,
        [string]$Name
    )

    Write-Host $Name
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Find-RarTool {
    $configured = @(
        $env:RAR_EXTRACTION_TOOL,
        (Get-EnvValue -Path $EnvFile -Key "RAR_EXTRACTION_TOOL")
    )
    foreach ($path in $configured | Select-Object -Unique) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $path).Path
        }
    }

    foreach ($toolName in @("7z.exe", "unrar.exe", "unar.exe", "bsdtar.exe")) {
        $tool = Get-Command $toolName -ErrorAction SilentlyContinue
        if ($tool -and $tool.Source -and (Test-Path -LiteralPath $tool.Source -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $tool.Source).Path
        }
    }

    foreach ($toolPath in @(
        "C:\Program Files\7-Zip\7z.exe",
        "C:\Program Files\WinRAR\UnRAR.exe"
    )) {
        if (Test-Path -LiteralPath $toolPath -PathType Leaf) {
            return (Resolve-Path -LiteralPath $toolPath).Path
        }
    }
    return ""
}

if ($EnableAsyncArchives -and $DisableAsyncArchives) {
    throw "EnableAsyncArchives and DisableAsyncArchives cannot be used together."
}

$commonPythonPaths = @(
    (Join-Path $RepoRoot ".venv\Scripts\python.exe"),
    (Join-Path $BackendRoot ".venv\Scripts\python.exe"),
    (Join-Path $env:USERPROFILE "miniconda3\envs\occ\python.exe"),
    (Join-Path $env:USERPROFILE "anaconda3\envs\occ\python.exe"),
    (Join-Path $env:ProgramFiles "Python313\python.exe"),
    (Join-Path $env:ProgramFiles "Python312\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
    "D:\anaconda\envs\occ\python.exe",
    "D:\anaconda\python.exe"
)
$BackendPythonExe = Resolve-PythonPath `
    -RequestedPath $BackendPythonExe `
    -EnvironmentName "BACKEND_PYTHON" `
    -FallbackPaths $commonPythonPaths
$OccPythonExe = Resolve-PythonPath `
    -RequestedPath $OccPythonExe `
    -EnvironmentName "OCC_PYTHON" `
    -FallbackPaths (@($BackendPythonExe) + $commonPythonPaths) `
    -ProbeCode "from OCC.Core.BRep import BRep_Tool"

Write-Host "Repo:            $RepoRoot"
Write-Host "BACKEND_PYTHON:  $BackendPythonExe"
Write-Host "OCC_PYTHON:      $OccPythonExe"

Push-Location -LiteralPath $BackendRoot
try {
    if (-not $SkipDependencyInstall) {
        Invoke-Python `
            -Executable $BackendPythonExe `
            -Arguments @("-m", "pip", "install", "--disable-pip-version-check", "-r", $Requirements) `
            -Name "Installing complete backend requirements"
    }

    Invoke-Python `
        -Executable $BackendPythonExe `
        -Arguments @("-B", "-c", "import flask, sqlalchemy, waitress, py7zr, rarfile") `
        -Name "Validating backend runtime"
    Invoke-Python `
        -Executable $OccPythonExe `
        -Arguments @("-B", "-c", "from OCC.Core.BRep import BRep_Tool") `
        -Name "Validating OCC runtime"

    $repairArgs = @("-B", $RepairScript)
    if ($DatabaseUrl) {
        $repairArgs += @("--database-url", $DatabaseUrl)
    }
    if ($SkipBackup) {
        $repairArgs += "--no-backup"
    }
    Invoke-Python `
        -Executable $BackendPythonExe `
        -Arguments $repairArgs `
        -Name "Repairing archive extension settings"

    if (-not (Test-Path -LiteralPath $WorkerScript -PathType Leaf)) {
        throw "Quote worker entrypoint not found: $WorkerScript"
    }
    Invoke-Python `
        -Executable $BackendPythonExe `
        -Arguments @("-B", $WorkerScript, "--init-db") `
        -Name "Initializing the quote job database"
}
finally {
    Pop-Location
}

$rarTool = Find-RarTool
if (-not $rarTool) {
    if (-not $AllowMissingRarTool) {
        throw "RAR extraction tool not found. Install 7-Zip or UnRAR, then rerun. Use -AllowMissingRarTool only when RAR is intentionally disabled."
    }
    Write-Warning "RAR extraction is unavailable because no supported extractor was found."
}
else {
    $rarProbe = "import subprocess,sys; subprocess.run([sys.argv[1]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)"
    Invoke-Python `
        -Executable $BackendPythonExe `
        -Arguments @("-B", "-c", $rarProbe, $rarTool) `
        -Name "Validating RAR extractor executable"
    Set-EnvValue -Path $EnvFile -Key "RAR_EXTRACTION_TOOL" -Value $rarTool
    Write-Host "RAR extractor:    $rarTool"
}

Set-EnvValue -Path $EnvFile -Key "BACKEND_PYTHON" -Value $BackendPythonExe
Set-EnvValue -Path $EnvFile -Key "OCC_PYTHON" -Value $OccPythonExe
Set-EnvValue -Path $EnvFile -Key "QUOTE_CAD_CONCURRENCY" -Value "2" -OnlyIfMissing
if ($EnableAsyncArchives) {
    Set-EnvValue -Path $EnvFile -Key "QUOTE_ASYNC_ARCHIVES_ENABLED" -Value "1"
}
elseif ($DisableAsyncArchives) {
    Set-EnvValue -Path $EnvFile -Key "QUOTE_ASYNC_ARCHIVES_ENABLED" -Value "0"
}
else {
    Set-EnvValue -Path $EnvFile -Key "QUOTE_ASYNC_ARCHIVES_ENABLED" -Value "0" -OnlyIfMissing
}

$featureValue = Get-EnvValue -Path $EnvFile -Key "QUOTE_ASYNC_ARCHIVES_ENABLED"
Write-Host "Async archives:   $featureValue"
Write-Host "PASS: Backend dependencies, OCC runtime, archive support, and quote job database are ready."
Write-Host "Restart run-quote-worker.ps1 and run-api.ps1 to load these settings."
