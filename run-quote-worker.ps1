[CmdletBinding()]
param(
    [string]$BackendPython = "",
    [string]$OccPython = "",
    [int]$Concurrency = 0,
    [string]$LogPath = "",
    [string]$RuntimeTempRoot = "",
    [switch]$NoRestart
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
$WorkerScript = Join-Path $BackendRoot "scripts\run_quote_worker.py"
$DataRoot = Join-Path $BackendRoot "data"
$PidFile = Join-Path $DataRoot "quote-worker-host.pid"
$LockFile = Join-Path $DataRoot "quote-worker-host.lock"
$transcriptStarted = $false
$lockStream = $null

if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    $logParent = Split-Path -Parent $LogPath
    if ($logParent) {
        New-Item -ItemType Directory -Force -Path $logParent | Out-Null
    }
    if ((Test-Path -LiteralPath $LogPath -PathType Leaf) -and (Get-Item -LiteralPath $LogPath).Length -ge 10MB) {
        $rotatedLog = "$LogPath.1"
        Remove-Item -LiteralPath $rotatedLog -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $LogPath -Destination $rotatedLog -Force
    }
    Start-Transcript -LiteralPath $LogPath -Append | Out-Null
    $transcriptStarted = $true
}

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

Import-EnvFile -Path $EnvFile

if (-not [string]::IsNullOrWhiteSpace($RuntimeTempRoot)) {
    $RuntimeTempRoot = [IO.Path]::GetFullPath($RuntimeTempRoot)
    if (-not (Test-Path -LiteralPath $RuntimeTempRoot -PathType Container)) {
        throw "Precision Tools worker runtime temp directory was not prepared"
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

if (-not (Test-Path -LiteralPath $WorkerScript -PathType Leaf)) {
    throw "Quote worker entrypoint not found: $WorkerScript"
}

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

try {
    try {
        $lockStream = [System.IO.File]::Open(
            $LockFile,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    }
    catch [System.IO.IOException] {
        Write-Host "Quote worker is already running for this project."
        exit 0
    }
    catch [System.UnauthorizedAccessException] {
        Write-Warning "The cross-session quote worker lock is owned by another account. A second worker will not be started."
        exit 0
    }

    if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
        $existingPidText = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
        $existingPid = 0
        if ([int]::TryParse($existingPidText, [ref]$existingPid) -and $existingPid -ne $PID) {
            $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
            if ($existingProcess -and $existingProcess.CommandLine -like "*run-quote-worker.ps1*") {
                Write-Warning "Quote worker PID $existingPid is still running without the current lock contract. A second worker will not be started."
                exit 0
            }
        }
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }

    [System.IO.File]::WriteAllText($PidFile, [string]$PID, $Utf8NoBom)

    $env:BACKEND_PYTHON = $BackendPython
    $env:OCC_PYTHON = $OccPython
    if ($Concurrency -gt 0) {
        $env:QUOTE_CAD_CONCURRENCY = [string]$Concurrency
    }
    elseif ([string]::IsNullOrWhiteSpace($env:QUOTE_CAD_CONCURRENCY)) {
        $env:QUOTE_CAD_CONCURRENCY = "2"
    }
    if ([string]::IsNullOrWhiteSpace($env:QUOTE_ASYNC_ARCHIVES_ENABLED)) {
        $env:QUOTE_ASYNC_ARCHIVES_ENABLED = "0"
    }

    Set-Location -LiteralPath $BackendRoot
    & $BackendPython -B -c "import flask, sqlalchemy"
    if ($LASTEXITCODE -ne 0) {
        throw "BACKEND_PYTHON cannot import the worker dependencies."
    }
    & $OccPython -B -c "from OCC.Core.BRep import BRep_Tool"
    if ($LASTEXITCODE -ne 0) {
        throw "OCC_PYTHON cannot import pythonocc-core."
    }

    $restartDelay = 1
    while ($true) {
        $startedAt = Get-Date
        Write-Host ("Starting quote worker with concurrency {0}." -f $env:QUOTE_CAD_CONCURRENCY)
        & $BackendPython -B $WorkerScript
        $exitCode = $LASTEXITCODE

        if ($NoRestart) {
            if ($exitCode -ne 0) {
                throw "Quote worker exited with code $exitCode."
            }
            break
        }

        $runtimeSeconds = ((Get-Date) - $startedAt).TotalSeconds
        if ($runtimeSeconds -ge 60) {
            $restartDelay = 1
        }
        Write-Warning "Quote worker exited with code $exitCode. Restarting in $restartDelay second(s)."
        Start-Sleep -Seconds $restartDelay
        $restartDelay = [Math]::Min($restartDelay * 2, 15)
    }
}
finally {
    if (Test-Path -LiteralPath $PidFile) {
        $pidText = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($pidText -eq [string]$PID) {
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }
    }
    if ($lockStream) {
        $lockStream.Dispose()
    }
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
}
