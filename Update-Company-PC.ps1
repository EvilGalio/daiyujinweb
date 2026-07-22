<#
Pull framework/code changes on the company PC while preserving local data.

Usage:
  .\Update-Company-PC.ps1

Before pulling code, this script creates one unified Order Portal backup via
Backup-OrderPortal.ps1. Backup packages live under:
  local_backups/order_portal

The async quote job database and its referenced job storage are packaged under:
  local_backups/quote_jobs
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$Remote = "origin",
    [string]$Branch = "",
    [string]$CondaEnvName = "occ",
    [string]$BackendPython = "",
    [string]$OccPython = "",
    [string]$GitProxy = "",
    [int]$ApiPort = 5000,
    [int]$QuoteBackupRetentionCount = 7,
    [switch]$SkipDependencyInstall,
    [switch]$SkipDatabaseBackup,
    [switch]$SkipInitDb,
    [switch]$SkipApiRestart,
    [switch]$SkipWorkerRestart,
    [switch]$SkipWorkerTaskRegistration,
    [Alias("RunWorkerTaskAtStartupAsSystem")]
    [switch]$RunWorkerTaskAtStartupAsLocalService,
    [switch]$AllowMissingRarTool,
    [switch]$EnableAsyncArchives,
    [switch]$DisableAsyncArchives,
    [switch]$PostPullRelaunch,
    [switch]$RestoreApiOnFailure,
    [switch]$RestoreWorkerOnFailure
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$Script:InvocationParameters = @{} + $PSBoundParameters
$Script:UpdateScriptPath = (Resolve-Path -LiteralPath $MyInvocation.MyCommand.Path).Path
$Script:InitialSelfHash = (Get-FileHash -LiteralPath $Script:UpdateScriptPath -Algorithm SHA256).Hash

if ($EnableAsyncArchives -and $DisableAsyncArchives) {
    throw "EnableAsyncArchives and DisableAsyncArchives cannot be used together."
}
if ($QuoteBackupRetentionCount -lt 1) {
    throw "QuoteBackupRetentionCount must be at least 1."
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$LogPath = Join-Path $ProjectRoot "company-update.log"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OrderPortalBackupRoot = Join-Path (Join-Path $ProjectRoot "local_backups") "order_portal"
$UpdatePatchBackupRoot = Join-Path $OrderPortalBackupRoot "update_patches"
$QuoteBackupRoot = Join-Path (Join-Path $ProjectRoot "local_backups") "quote_jobs"
$EnvFile = Join-Path $BackendRoot ".env"
$WorkerPidFile = Join-Path $BackendRoot "data\quote-worker-host.pid"
$WorkerTaskName = "Daiyujin Quote Worker"
$ApiTaskName = "Daiyujin Precision Tools API"
$PrecisionRuntimeRoot = "C:\ProgramData\Daiyujin\PrecisionTools\runtime"
$Script:GitProxyResolved = $false
$Script:ResolvedGitProxy = ""
$Script:BackendPython = ""
$Script:OccPython = ""
$Script:WorkerTaskWasPresent = $false
$Script:WorkerTaskWasEnabled = $false
$Script:WorkerTaskRunsAtStartupAsLocalService = $false
$Script:WorkerTaskWasPaused = $false
$Script:QuoteMaintenanceActive = $false
$Script:QuoteMaintenanceFile = ""
$Script:QuoteMaintenanceToken = ""
$Script:ApiWasStopped = [bool]$RestoreApiOnFailure
$Script:ApiTaskWasPresent = [bool]$RestoreApiOnFailure
$Script:ApiTaskWasEnabled = [bool]$RestoreApiOnFailure
$Script:ApiTaskWasPaused = [bool]$RestoreApiOnFailure
$Script:WorkerProcessWasStopped = [bool]$RestoreWorkerOnFailure

function Write-Step {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line -ForegroundColor Cyan
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Write-Note {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Write-Warn {
    param([string]$Message)
    $line = "[{0}] WARNING: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Warning $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Run-Native {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [Parameter(Mandatory=$true)][string]$Name
    )

    Write-Step $Name
    Write-Note ("Command: {0} {1}" -f $FilePath, ($Arguments -join " "))

    $stdoutLog = Join-Path $ProjectRoot ("company-update-native-out-{0}.tmp" -f ([guid]::NewGuid().ToString("N")))
    $stderrLog = Join-Path $ProjectRoot ("company-update-native-err-{0}.tmp" -f ([guid]::NewGuid().ToString("N")))
    $argLine = ($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "

    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $argLine `
        -WorkingDirectory (Get-Location).Path `
        -Wait `
        -PassThru `
        -NoNewWindow `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog

    foreach ($nativeLog in @($stdoutLog, $stderrLog)) {
        if (Test-Path -LiteralPath $nativeLog) {
            Get-Content -LiteralPath $nativeLog | Tee-Object -FilePath $LogPath -Append
            Remove-Item -LiteralPath $nativeLog -Force -ErrorAction SilentlyContinue
        }
    }

    $exitCode = $process.ExitCode

    if ($exitCode -ne 0) {
        throw "$Name failed with exit code $exitCode"
    }
}

function ConvertTo-CommandLineArgument {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value -or $Value.Length -eq 0) {
        return '""'
    }
    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Resolve-PrincipalSid {
    param([string]$UserId)
    try {
        if ($UserId -match "^S-\d-") {
            return [Security.Principal.SecurityIdentifier]::new($UserId).Value
        }
        return [Security.Principal.NTAccount]::new($UserId).Translate(
            [Security.Principal.SecurityIdentifier]
        ).Value
    }
    catch {
        return ""
    }
}

function Quote-ScheduledTaskArgument {
    param([string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Get-RootScheduledTask {
    param([string]$TaskName)
    $matches = @(
        Get-ScheduledTask -TaskName $TaskName -TaskPath "\" `
            -ErrorAction SilentlyContinue
    )
    if ($matches.Count -gt 1) {
        throw "More than one root scheduled task uses the protected task name: $TaskName"
    }
    if ($matches.Count -eq 0) {
        return $null
    }
    return $matches[0]
}

function Get-ExpectedWorkerTaskArguments {
    $launcher = Join-Path $ProjectRoot "run-quote-worker.ps1"
    $runtimeLog = Join-Path $PrecisionRuntimeRoot `
        "logs\quote-worker-scheduled.log"
    $runtimeTemp = Join-Path $PrecisionRuntimeRoot "temp"
    return @(
        "-NoProfile",
        "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-ScheduledTaskArgument $launcher),
        "-BackendPython", (Quote-ScheduledTaskArgument $Script:BackendPython),
        "-OccPython", (Quote-ScheduledTaskArgument $Script:OccPython),
        "-LogPath", (Quote-ScheduledTaskArgument $runtimeLog),
        "-RuntimeTempRoot", (Quote-ScheduledTaskArgument $runtimeTemp)
    ) -join " "
}

function Assert-WorkerTaskContract {
    param([object]$Task)
    $actions = @($Task.Actions)
    $powerShell = Join-Path $env:SystemRoot `
        "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (
        $actions.Count -ne 1 -or
        (Resolve-PrincipalSid ([string]$Task.Principal.UserId)) -ne "S-1-5-19" -or
        [string]$actions[0].Execute -ne $powerShell -or
        [string]$actions[0].WorkingDirectory -ne $ProjectRoot -or
        [string]$actions[0].Arguments -ne (Get-ExpectedWorkerTaskArguments)
    ) {
        throw "The quote worker task does not match the approved LocalService runtime"
    }
}

function Get-ExpectedApiTaskArguments {
    $launcher = Join-Path $ProjectRoot "run-api.ps1"
    $runtimeTemp = Join-Path $PrecisionRuntimeRoot "temp"
    return @(
        "-NoProfile",
        "-WindowStyle", "Hidden",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-ScheduledTaskArgument $launcher),
        "-BackendPython", (Quote-ScheduledTaskArgument $Script:BackendPython),
        "-OccPython", (Quote-ScheduledTaskArgument $Script:OccPython),
        "-RuntimeTempRoot", (Quote-ScheduledTaskArgument $runtimeTemp),
        "-ApiPort", $ApiPort
    ) -join " "
}

function Assert-ApiTaskContract {
    param([object]$Task)
    $actions = @($Task.Actions)
    $powerShell = Join-Path $env:SystemRoot `
        "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (
        $actions.Count -ne 1 -or
        (Resolve-PrincipalSid ([string]$Task.Principal.UserId)) -ne "S-1-5-19" -or
        [string]$actions[0].Execute -ne $powerShell -or
        [string]$actions[0].WorkingDirectory -ne $ProjectRoot -or
        [string]$actions[0].Arguments -ne (Get-ExpectedApiTaskArguments)
    ) {
        throw "The Precision Tools API task does not match the approved LocalService runtime"
    }
}

function Test-LocalTcpPort {
    param([int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(250, $false)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Resolve-GitProxy {
    if ($Script:GitProxyResolved) {
        return $Script:ResolvedGitProxy
    }

    $Script:GitProxyResolved = $true

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($GitProxy)) {
        $candidates += $GitProxy.Trim()
    }
    if (-not [string]::IsNullOrWhiteSpace($env:DYJ_GIT_PROXY)) {
        $candidates += $env:DYJ_GIT_PROXY.Trim()
    }
    if (-not [string]::IsNullOrWhiteSpace($env:HTTPS_PROXY)) {
        $candidates += $env:HTTPS_PROXY.Trim()
    }
    if (-not [string]::IsNullOrWhiteSpace($env:HTTP_PROXY)) {
        $candidates += $env:HTTP_PROXY.Trim()
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ($candidate) {
            $Script:ResolvedGitProxy = $candidate
            Write-Note "Using Git proxy: $candidate"
            return $Script:ResolvedGitProxy
        }
    }

    foreach ($port in @(4780, 7890, 7897, 7899, 7898, 10809, 1080)) {
        if (Test-LocalTcpPort -Port $port) {
            $Script:ResolvedGitProxy = "http://127.0.0.1:$port"
            Write-Note "Auto-detected local Git proxy: $($Script:ResolvedGitProxy)"
            return $Script:ResolvedGitProxy
        }
    }

    foreach ($port in @(4781)) {
        if (Test-LocalTcpPort -Port $port) {
            $Script:ResolvedGitProxy = "socks5h://127.0.0.1:$port"
            Write-Note "Auto-detected local SOCKS Git proxy: $($Script:ResolvedGitProxy)"
            return $Script:ResolvedGitProxy
        }
    }

    Write-Warn "No local Git proxy detected. Git will try a direct connection."
    return ""
}

function New-GitArguments {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)

    $proxy = Resolve-GitProxy
    if ([string]::IsNullOrWhiteSpace($proxy)) {
        return $Arguments
    }
    return @("-c", "http.proxy=$proxy", "-c", "https.proxy=$proxy") + $Arguments
}

function Save-TrackedLocalChanges {
    Write-Step "Checking tracked local code changes"
    Set-Location -LiteralPath $ProjectRoot

    $trackedChanges = @(git status --porcelain --untracked-files=no)
    if ($trackedChanges.Count -eq 0) {
        Write-Note "No tracked local code changes found."
        return
    }

    Write-Warn "Tracked local code changes found. They will be stashed before pull and not automatically reapplied."
    $trackedChanges | ForEach-Object { Write-Note $_ }

    $backupDir = $UpdatePatchBackupRoot
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

    $patchPath = Join-Path $backupDir "tracked-code-changes-$Stamp.patch"
    git diff --binary | Set-Content -LiteralPath $patchPath -Encoding UTF8
    Write-Note "Tracked code diff backup: $patchPath"

    Run-Native -FilePath "git" -Arguments @("stash", "push", "-m", "company tracked code changes before update $Stamp", "--", ".") -Name "git stash tracked code changes"
}

function Find-Conda {
    $paths = @()
    $cmd = Get-Command conda -ErrorAction SilentlyContinue
    if ($cmd) { $paths += $cmd.Source }

    $paths += @(
        "$env:USERPROFILE\miniconda3\Scripts\conda.exe",
        "$env:LOCALAPPDATA\miniconda3\Scripts\conda.exe",
        "$env:ProgramData\miniconda3\Scripts\conda.exe",
        "$env:USERPROFILE\anaconda3\Scripts\conda.exe",
        "$env:LOCALAPPDATA\anaconda3\Scripts\conda.exe",
        "$env:ProgramData\anaconda3\Scripts\conda.exe",
        "D:\anaconda\Scripts\conda.exe"
    )

    foreach ($p in $paths | Select-Object -Unique) {
        if ($p -and (Test-Path -LiteralPath $p)) {
            return (Resolve-Path -LiteralPath $p).Path
        }
    }
    return $null
}

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

function Resolve-BackendRuntimePath {
    param(
        [string]$Key,
        [string]$DefaultRelativePath
    )

    $configuredPath = Get-EnvValue -Path $EnvFile -Key $Key
    if ([string]::IsNullOrWhiteSpace($configuredPath)) {
        return [System.IO.Path]::GetFullPath((Join-Path $BackendRoot $DefaultRelativePath))
    }
    if ([System.IO.Path]::IsPathRooted($configuredPath)) {
        return [System.IO.Path]::GetFullPath($configuredPath)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $BackendRoot $configuredPath))
}

function Enable-QuoteMaintenance {
    $maintenanceFile = Resolve-BackendRuntimePath `
        -Key "QUOTE_JOB_MAINTENANCE_FILE" `
        -DefaultRelativePath "data\quote-async-maintenance.flag"
    if (Test-Path -LiteralPath $maintenanceFile -PathType Leaf) {
        throw "Quote maintenance is already active: $maintenanceFile"
    }

    $parent = Split-Path -Parent $maintenanceFile
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $token = "company-update:{0}:{1}" -f $PID, ([guid]::NewGuid().ToString("N"))
    [System.IO.File]::WriteAllText($maintenanceFile, $token, $Utf8NoBom)
    $Script:QuoteMaintenanceFile = $maintenanceFile
    $Script:QuoteMaintenanceToken = $token
    $Script:QuoteMaintenanceActive = $true
    Write-Note "Paused new asynchronous quote job creation."
}

function Wait-ForQuoteUploadsToDrain {
    $storageRoot = Resolve-BackendRuntimePath `
        -Key "QUOTE_JOB_STORAGE_ROOT" `
        -DefaultRelativePath "uploads\quote-jobs"
    $stagingRoot = Join-Path $storageRoot ".staging"
    $deadline = (Get-Date).AddSeconds(120)
    $emptyChecks = 0

    Write-Step "Waiting for in-flight quote uploads to drain"
    while ((Get-Date) -lt $deadline) {
        $activeUploads = @()
        if (Test-Path -LiteralPath $stagingRoot -PathType Container) {
            $activeUploads = @(
                Get-ChildItem -LiteralPath $stagingRoot -File -Filter "upload-*.part" -ErrorAction SilentlyContinue
            )
        }
        if ($activeUploads.Count -eq 0) {
            $emptyChecks += 1
            if ($emptyChecks -ge 4) {
                Write-Note "No in-flight quote uploads remain."
                return
            }
        }
        else {
            $emptyChecks = 0
            Write-Note ("Waiting for {0} in-flight quote upload(s)." -f $activeUploads.Count)
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for in-flight quote uploads to drain."
}

function Disable-QuoteMaintenance {
    if (-not $Script:QuoteMaintenanceActive) {
        return
    }

    if (Test-Path -LiteralPath $Script:QuoteMaintenanceFile -PathType Leaf) {
        $currentToken = (Get-Content -LiteralPath $Script:QuoteMaintenanceFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($currentToken -ne $Script:QuoteMaintenanceToken) {
            Write-Warn "Quote maintenance flag ownership changed; preserving the flag."
            $Script:QuoteMaintenanceActive = $false
            return
        }
        Remove-Item -LiteralPath $Script:QuoteMaintenanceFile -Force
    }
    $Script:QuoteMaintenanceActive = $false
    Write-Note "Resumed asynchronous quote job creation."
}

function Get-CondaEnvironmentPython {
    $conda = Find-Conda
    if (-not $conda) {
        return ""
    }
    try {
        $json = & $conda env list --json 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $json) {
            return ""
        }
        $environments = @((($json -join [Environment]::NewLine) | ConvertFrom-Json).envs)
        foreach ($environmentPath in $environments) {
            if ((Split-Path -Leaf $environmentPath) -eq $CondaEnvName) {
                $candidate = Join-Path $environmentPath "python.exe"
                if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                    return (Resolve-Path -LiteralPath $candidate).Path
                }
            }
        }
    }
    catch {
        Write-Warn "Could not inspect Conda environments: $($_.Exception.Message)"
    }
    return ""
}

function Resolve-PythonRuntime {
    param(
        [string]$RequestedPath,
        [string]$EnvironmentName,
        [string[]]$FallbackPaths,
        [string]$ProbeCode = "import sys"
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
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            continue
        }
        $resolved = (Resolve-Path -LiteralPath $candidate).Path
        & $resolved -B -c $ProbeCode 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            return $resolved
        }
    }
    throw "$EnvironmentName is not configured with a usable absolute path."
}

function Resolve-PythonRuntimes {
    Write-Step "Resolving explicit Python runtimes"

    $condaPython = Get-CondaEnvironmentPython
    $commonPaths = @(
        (Join-Path $ProjectRoot ".venv\Scripts\python.exe"),
        (Join-Path $BackendRoot ".venv\Scripts\python.exe"),
        $condaPython,
        (Join-Path $env:USERPROFILE "miniconda3\envs\$CondaEnvName\python.exe"),
        (Join-Path $env:USERPROFILE "anaconda3\envs\$CondaEnvName\python.exe"),
        (Join-Path $env:ProgramFiles "Python313\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        "D:\anaconda\envs\$CondaEnvName\python.exe",
        "D:\anaconda\python.exe"
    )

    $Script:BackendPython = Resolve-PythonRuntime `
        -RequestedPath $BackendPython `
        -EnvironmentName "BACKEND_PYTHON" `
        -FallbackPaths $commonPaths
    $Script:OccPython = Resolve-PythonRuntime `
        -RequestedPath $OccPython `
        -EnvironmentName "OCC_PYTHON" `
        -FallbackPaths (@($Script:BackendPython) + $commonPaths) `
        -ProbeCode "from OCC.Core.BRep import BRep_Tool"

    Write-Note "BACKEND_PYTHON: $($Script:BackendPython)"
    Write-Note "OCC_PYTHON: $($Script:OccPython)"
}

function Ensure-RuntimeDirectories {
    Write-Step "Ensuring runtime directories"
    $dirs = @(
        (Join-Path $BackendRoot "data"),
        (Join-Path $BackendRoot "private\order_media"),
        (Join-Path $BackendRoot "uploads"),
        (Join-Path $BackendRoot "static\thumbnails"),
        (Join-Path $BackendRoot "static\stl")
    )
    foreach ($dir in $dirs) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Note "Directory ready: $dir"
    }
}

function Test-LocalDataPresence {
    Write-Step "Checking local production data"

    $required = @(
        (Join-Path $BackendRoot "data\quote_model_v2_2\coefficients_v2_2_A.json"),
        (Join-Path $BackendRoot "data\quote_model_v2_2\material_public_options.json"),
        (Join-Path $BackendRoot "data\material_weight\shapes.json"),
        (Join-Path $BackendRoot "data\material_weight\material_density.csv"),
        (Join-Path $BackendRoot "data\material_standards\sources.csv")
    )

    $missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
    if ($missing.Count -gt 0) {
        Write-Warn "Some local data files are missing. Git will not provide backend/data because this public repo ignores it."
        $missing | ForEach-Object { Write-Warn "Missing: $_" }
        throw "Copy backend\data from the old/backup machine to this company PC once, then rerun."
    }
}

function Stop-QuoteWorker {
    param([switch]$PreserveStartupTask)

    if (-not $PreserveStartupTask) {
        $startupTask = Get-RootScheduledTask -TaskName $WorkerTaskName
        if ($startupTask) {
            Assert-WorkerTaskContract -Task $startupTask
            $Script:WorkerTaskWasPresent = $true
            $Script:WorkerTaskWasEnabled = $startupTask.State -ne "Disabled"
            $taskUserId = Resolve-PrincipalSid (
                [string]$startupTask.Principal.UserId
            )
            $Script:WorkerTaskRunsAtStartupAsLocalService = `
                $taskUserId -eq "S-1-5-19"
            Write-Step "Pausing quote worker startup task during update"
            Stop-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
                -ErrorAction SilentlyContinue
            if ($Script:WorkerTaskWasEnabled) {
                Disable-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
                    -ErrorAction Stop | Out-Null
                $Script:WorkerTaskWasPaused = $true
            }
        }
    }

    if (-not (Test-Path -LiteralPath $WorkerPidFile -PathType Leaf)) {
        Write-Note "No quote worker PID file found."
        return
    }

    $pidText = (Get-Content -LiteralPath $WorkerPidFile -Raw -ErrorAction SilentlyContinue).Trim()
    $workerPid = 0
    if (-not [int]::TryParse($pidText, [ref]$workerPid)) {
        Write-Warn "Removing invalid quote worker PID file: $WorkerPidFile"
        Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
        return
    }

    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction SilentlyContinue
    if (-not $processInfo) {
        Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
        Write-Note "Removed stale quote worker PID file."
        return
    }
    if ($processInfo.CommandLine -notlike "*run-quote-worker.ps1*") {
        Write-Warn "PID $workerPid does not belong to run-quote-worker.ps1. The process was not stopped."
        Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
        return
    }

    Write-Step "Stopping quote worker process tree"
    $taskKill = Join-Path $env:SystemRoot "System32\taskkill.exe"
    & $taskKill /PID $workerPid /T /F | ForEach-Object { Write-Note $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "taskkill exited with code $LASTEXITCODE while stopping quote worker PID $workerPid."
    }
    Start-Sleep -Milliseconds 300
    $remainingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction SilentlyContinue
    if ($remainingProcess) {
        throw "Quote worker PID $workerPid is still running. Refusing to start a second worker."
    }
    Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
    $Script:WorkerProcessWasStopped = $true
}

function Backup-QuoteJobsBeforeUpdate {
    if ($SkipDatabaseBackup) {
        Write-Warn "Skipping quote job database backup before update."
        return
    }

    $configuredPath = Get-EnvValue -Path $EnvFile -Key "QUOTE_JOBS_DB_PATH"
    if ($configuredPath) {
        if ([System.IO.Path]::IsPathRooted($configuredPath)) {
            $quoteDb = $configuredPath
        }
        else {
            $quoteDb = Join-Path $BackendRoot $configuredPath
        }
    }
    else {
        $quoteDb = Join-Path $BackendRoot "data\quote_jobs.db"
    }

    $configuredStorage = Get-EnvValue -Path $EnvFile -Key "QUOTE_JOB_STORAGE_ROOT"
    if ($configuredStorage) {
        if ([System.IO.Path]::IsPathRooted($configuredStorage)) {
            $quoteStorage = $configuredStorage
        }
        else {
            $quoteStorage = Join-Path $BackendRoot $configuredStorage
        }
    }
    else {
        $quoteStorage = Join-Path $BackendRoot "uploads\quote-jobs"
    }

    $hasDatabase = Test-Path -LiteralPath $quoteDb -PathType Leaf
    $hasStorage = Test-Path -LiteralPath $quoteStorage -PathType Container
    if (-not $hasDatabase -and -not $hasStorage) {
        Write-Note "No quote job database or job storage exists yet; no quote job backup is needed."
        return
    }

    New-Item -ItemType Directory -Force -Path $QuoteBackupRoot | Out-Null
    $backupDir = Join-Path $QuoteBackupRoot "quote-jobs-$Stamp"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

    if ($hasDatabase) {
        $backupPath = Join-Path $backupDir "quote_jobs.db"
        $backupCode = "import sqlite3,sys; source=sqlite3.connect(sys.argv[1]); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.close(); source.close()"
        Run-Native `
            -FilePath $Script:BackendPython `
            -Arguments @("-B", "-c", $backupCode, $quoteDb, $backupPath) `
            -Name "Creating safe quote job database snapshot"
    }

    if ($hasStorage) {
        $storageBackup = Join-Path $backupDir "job-storage"
        New-Item -ItemType Directory -Force -Path $storageBackup | Out-Null
        Get-ChildItem -LiteralPath $quoteStorage -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $storageBackup -Recurse -Force
        }
    }

    $manifest = [ordered]@{
        created_at = (Get-Date).ToString("o")
        database_source = [System.IO.Path]::GetFullPath($quoteDb)
        storage_source = [System.IO.Path]::GetFullPath($quoteStorage)
        database_included = [bool]$hasDatabase
        storage_included = [bool]$hasStorage
    } | ConvertTo-Json
    [System.IO.File]::WriteAllText(
        (Join-Path $backupDir "manifest.json"),
        $manifest,
        $Utf8NoBom
    )
    Write-Note "Quote job backup package: $backupDir"

    $resolvedBackupRoot = [System.IO.Path]::GetFullPath($QuoteBackupRoot).TrimEnd("\")
    $backupPrefix = $resolvedBackupRoot + "\"
    $expiredBackups = @(
        Get-ChildItem -LiteralPath $QuoteBackupRoot -Directory -Filter "quote-jobs-*" |
            Sort-Object LastWriteTime -Descending |
            Select-Object -Skip $QuoteBackupRetentionCount
    )
    foreach ($expiredBackup in $expiredBackups) {
        $resolvedExpired = [System.IO.Path]::GetFullPath($expiredBackup.FullName)
        if (-not $resolvedExpired.StartsWith($backupPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove quote backup outside the backup root: $resolvedExpired"
        }
        Remove-Item -LiteralPath $resolvedExpired -Recurse -Force
        Write-Note "Removed expired quote job backup: $resolvedExpired"
    }
}

function Backup-OrderPortalBeforeUpdate {
    if ($SkipDatabaseBackup) {
        Write-Warn "Skipping unified Order Portal backup before update."
        return
    }

    $backupScript = Join-Path $ProjectRoot "Backup-OrderPortal.ps1"
    if (-not (Test-Path -LiteralPath $backupScript)) {
        throw "Backup-OrderPortal.ps1 not found. Refusing to update without a unified production backup."
    }

    New-Item -ItemType Directory -Force -Path $OrderPortalBackupRoot | Out-Null
    $ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    Run-Native -FilePath $ps -Arguments @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $backupScript,
        "-ProjectRoot", $ProjectRoot,
        "-BackupRoot", $OrderPortalBackupRoot,
        "-Mode", "Daily"
    ) -Name "Creating unified Order Portal backup before update"
}

function Pull-FrameworkChanges {
    Write-Step "Pulling framework/code changes from Git"
    Set-Location -LiteralPath $ProjectRoot

    git rev-parse --is-inside-work-tree | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "ProjectRoot is not a Git repository: $ProjectRoot"
    }

    if ([string]::IsNullOrWhiteSpace($Branch)) {
        $Branch = (git branch --show-current).Trim()
    }
    if ([string]::IsNullOrWhiteSpace($Branch)) {
        throw "Cannot detect current branch. Pass -Branch explicitly."
    }

    $status = @(git status --porcelain)
    if ($status.Count -gt 0) {
        Write-Warn "Working tree has local changes. Git pull may fail if they touch tracked files."
        $status | ForEach-Object { Write-Note $_ }
    }

    Save-TrackedLocalChanges

    Run-Native -FilePath "git" -Arguments (New-GitArguments -Arguments @("fetch", "--no-progress", $Remote)) -Name "git fetch"
    Run-Native -FilePath "git" -Arguments (New-GitArguments -Arguments @("pull", "--ff-only", $Remote, $Branch)) -Name "git pull --ff-only"
}

function Restart-WithUpdatedScriptIfNeeded {
    if ($PostPullRelaunch) {
        return
    }

    $currentHash = (Get-FileHash -LiteralPath $Script:UpdateScriptPath -Algorithm SHA256).Hash
    if ($currentHash -eq $Script:InitialSelfHash) {
        return
    }

    Write-Step "Update script changed; relaunching the pulled version"
    if ($Script:WorkerTaskWasPaused -and $Script:WorkerTaskWasEnabled) {
        Enable-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
            -ErrorAction Stop | Out-Null
        $Script:WorkerTaskWasPaused = $false
        Write-Note "Restored the worker task state before handing off to the pulled script."
    }
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $Script:UpdateScriptPath
    )
    foreach ($entry in $Script:InvocationParameters.GetEnumerator() | Sort-Object Key) {
        if ($entry.Key -in @("PostPullRelaunch", "RestoreApiOnFailure", "RestoreWorkerOnFailure")) {
            continue
        }
        if ($entry.Value -is [System.Management.Automation.SwitchParameter]) {
            if ($entry.Value.IsPresent) {
                $arguments += "-$($entry.Key)"
            }
            continue
        }
        $arguments += "-$($entry.Key)"
        $arguments += [string]$entry.Value
    }
    if ($Script:ApiWasStopped) {
        $arguments += "-RestoreApiOnFailure"
    }
    if ($Script:WorkerProcessWasStopped) {
        $arguments += "-RestoreWorkerOnFailure"
    }
    $arguments += "-PostPullRelaunch"

    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $argumentLine = ($arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "
    $process = Start-Process `
        -FilePath $powerShell `
        -ArgumentList $argumentLine `
        -WorkingDirectory $ProjectRoot `
        -Wait `
        -PassThru `
        -NoNewWindow
    if ($process.ExitCode -ne 0) {
        throw "The relaunched update script failed with exit code $($process.ExitCode)."
    }
    exit 0
}

function Install-Dependencies {
    if ($SkipDependencyInstall) {
        Write-Warn "Skipping dependency install."
        return
    }

    $requirements = Join-Path $BackendRoot "requirements.txt"
    Run-Native `
        -FilePath $Script:BackendPython `
        -Arguments @("-m", "pip", "install", "--disable-pip-version-check", "-r", $requirements) `
        -Name "Installing complete backend requirements"
}

function Init-DatabaseSchema {
    if ($SkipInitDb) {
        Write-Warn "Skipping init_db."
        return
    }

    $initScript = Join-Path $BackendRoot "scripts\init_db.py"
    if (Test-Path -LiteralPath $initScript) {
        Run-Native `
            -FilePath $Script:BackendPython `
            -Arguments @("-B", $initScript) `
            -Name "Applying additive database schema updates"
    }
}

function Configure-ArchiveRuntime {
    $enableScript = Join-Path $BackendRoot "scripts\enable_archive_uploads.ps1"
    if (-not (Test-Path -LiteralPath $enableScript -PathType Leaf)) {
        throw "Archive setup script not found: $enableScript"
    }

    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $enableScript,
        "-BackendPythonExe", $Script:BackendPython,
        "-OccPythonExe", $Script:OccPython,
        "-SkipDependencyInstall",
        "-SkipBackup"
    )
    if ($AllowMissingRarTool) {
        $arguments += "-AllowMissingRarTool"
    }
    if ($EnableAsyncArchives) {
        $arguments += "-EnableAsyncArchives"
    }
    elseif ($DisableAsyncArchives) {
        $arguments += "-DisableAsyncArchives"
    }

    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    Run-Native `
        -FilePath $powerShell `
        -Arguments $arguments `
        -Name "Validating archive and quote worker runtime"
}

function Restart-QuoteWorker {
    if ($DisableAsyncArchives) {
        Write-Warn "Async archives are disabled; leaving the current quote worker unchanged."
        return
    }
    if ($SkipWorkerRestart) {
        Write-Warn "Skipping quote worker restart."
        return
    }

    Stop-QuoteWorker -PreserveStartupTask
    Write-Step "Starting quote worker supervisor"

    $runWorker = Join-Path $ProjectRoot "run-quote-worker.ps1"
    if (-not (Test-Path -LiteralPath $runWorker -PathType Leaf)) {
        throw "run-quote-worker.ps1 not found: $runWorker"
    }

    $outLog = Join-Path $ProjectRoot "quote-worker-runtime.out.log"
    $errLog = Join-Path $ProjectRoot "quote-worker-runtime.err.log"
    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $runWorker,
        "-BackendPython", $Script:BackendPython,
        "-OccPython", $Script:OccPython
    )
    $argumentLine = ($arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "

    $startupTask = Get-RootScheduledTask -TaskName $WorkerTaskName
    $startupPrincipal = if ($null -ne $startupTask) {
        Resolve-PrincipalSid ([string]$startupTask.Principal.UserId)
    }
    else {
        ""
    }
    if ($startupPrincipal -eq "S-1-5-19") {
        Assert-WorkerTaskContract -Task $startupTask
        Enable-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
            -ErrorAction Stop | Out-Null
        Start-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
            -ErrorAction Stop
        Write-Note "Starting quote worker through the LocalService startup task."
    }
    else {
        throw "The production quote worker LocalService task is missing"
    }

    for ($i = 1; $i -le 20; $i++) {
        if (Test-Path -LiteralPath $WorkerPidFile -PathType Leaf) {
            $pidText = (Get-Content -LiteralPath $WorkerPidFile -Raw -ErrorAction SilentlyContinue).Trim()
            $workerPid = 0
            if ([int]::TryParse($pidText, [ref]$workerPid) -and (Get-Process -Id $workerPid -ErrorAction SilentlyContinue)) {
                $Script:WorkerTaskWasPaused = $false
                $Script:WorkerProcessWasStopped = $false
                Write-Note "Quote worker supervisor started with PID $workerPid."
                return
            }
        }
        Start-Sleep -Milliseconds 500
    }

    throw "Quote worker did not start. Check $outLog and $errLog."
}

function Register-QuoteWorkerStartupTask {
    if ($DisableAsyncArchives) {
        Write-Warn "Async archives are disabled; leaving the quote worker startup task unchanged."
        return
    }
    $existingTask = Get-RootScheduledTask -TaskName $WorkerTaskName
    if ($existingTask -and -not $Script:WorkerTaskWasPresent) {
        Assert-WorkerTaskContract -Task $existingTask
        $Script:WorkerTaskWasPresent = $true
        $Script:WorkerTaskWasEnabled = $existingTask.State -ne "Disabled"
        $taskUserId = Resolve-PrincipalSid (
            [string]$existingTask.Principal.UserId
        )
        $Script:WorkerTaskRunsAtStartupAsLocalService = `
            $taskUserId -eq "S-1-5-19"
    }

    if ($SkipWorkerTaskRegistration) {
        Write-Warn "Skipping quote worker startup task registration."
        if ($Script:WorkerTaskWasPresent -and $Script:WorkerTaskWasEnabled) {
            Enable-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
                -ErrorAction Stop | Out-Null
            $Script:WorkerTaskWasPaused = $false
            Write-Note "Restored the existing quote worker startup task."
        }
        return
    }

    $installScript = Join-Path $ProjectRoot "Install-Quote-Worker-Task.ps1"
    if (-not (Test-Path -LiteralPath $installScript -PathType Leaf)) {
        throw "Quote worker task installer not found: $installScript"
    }

    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $installScript,
            "-ProjectRoot", $ProjectRoot,
            "-BackendPython", $Script:BackendPython,
            "-OccPython", $Script:OccPython,
            "-TaskName", $WorkerTaskName
    )
    $arguments += "-RunAtStartupAsLocalService"
    Run-Native `
        -FilePath $powerShell `
        -Arguments $arguments `
        -Name "Registering quote worker startup task"

    if ($Script:WorkerTaskWasPresent -and -not $Script:WorkerTaskWasEnabled) {
        Disable-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
            -ErrorAction Stop | Out-Null
        Write-Note "Preserved the existing disabled quote worker task state."
    }
}

function Stop-Api {
    Write-Step "Stopping local API"
    $apiTask = Get-RootScheduledTask -TaskName $ApiTaskName
    if ($null -eq $apiTask) {
        throw "The production Precision Tools API LocalService task is missing"
    }
    Assert-ApiTaskContract -Task $apiTask
    if (-not $Script:ApiTaskWasPresent) {
        if ([string]$apiTask.State -eq "Disabled") {
            throw "The production Precision Tools API task was disabled before the update"
        }
        $Script:ApiTaskWasPresent = $true
        $Script:ApiTaskWasEnabled = $true
    }
    Stop-ScheduledTask -TaskName $ApiTaskName -TaskPath "\" `
        -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $ApiTaskName -TaskPath "\" `
        -ErrorAction Stop | Out-Null
    $Script:ApiTaskWasPaused = $true
    $Script:ApiWasStopped = $true
    try {
        $connections = @(
            Get-NetTCPConnection `
                -LocalAddress "127.0.0.1" `
                -LocalPort $ApiPort `
                -State Listen `
                -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
        )
        $expectedApiExecutables = @(
            (Resolve-Path -LiteralPath $Script:BackendPython).Path,
            (Resolve-Path -LiteralPath $Script:OccPython).Path
        ) | Select-Object -Unique
        foreach ($processId in $connections) {
            $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
            $isExpectedApi = $processInfo `
                -and $processInfo.ExecutablePath `
                -and ($expectedApiExecutables -contains [System.IO.Path]::GetFullPath($processInfo.ExecutablePath)) `
                -and $processInfo.CommandLine -like "*waitress*" `
                -and $processInfo.CommandLine -like "*app:app*"
            if (-not $isExpectedApi) {
                throw "Port $ApiPort is owned by an unrelated process (PID $processId). Refusing to stop it."
            }
            Write-Note "Stopping Daiyujin API process $processId on 127.0.0.1:$ApiPort"
            Stop-Process -Id $processId -Force -ErrorAction Stop
            $Script:ApiWasStopped = $true
        }
    } catch {
        throw "Could not safely stop the existing API process: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 1
}

function Restart-Api {
    if ($SkipApiRestart) {
        Write-Warn "Skipping API restart."
        return
    }

    Write-Step "Restarting local API"
    Stop-Api

    $runApi = Join-Path $ProjectRoot "run-api.ps1"
    if (-not (Test-Path -LiteralPath $runApi)) {
        throw "run-api.ps1 not found: $runApi"
    }

    $outLog = Join-Path $ProjectRoot "api-runtime.out.log"
    $errLog = Join-Path $ProjectRoot "api-runtime.err.log"

    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $runApi,
        "-BackendPython", $Script:BackendPython,
        "-OccPython", $Script:OccPython,
        "-ApiPort", [string]$ApiPort
    )
    $argumentLine = ($arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "

    $apiTask = Get-RootScheduledTask -TaskName $ApiTaskName
    if ($null -ne $apiTask) {
        Assert-ApiTaskContract -Task $apiTask
        Enable-ScheduledTask -TaskName $ApiTaskName -TaskPath "\" `
            -ErrorAction Stop | Out-Null
        Start-ScheduledTask -TaskName $ApiTaskName -TaskPath "\" `
            -ErrorAction Stop
        Write-Note "Starting API through the LocalService startup task."
    }
    else {
        throw "The production Precision Tools API LocalService task is missing"
    }

    $base = "http://127.0.0.1:$ApiPort"
    for ($i = 1; $i -le 45; $i++) {
        try {
            $health = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
            $asyncValue = (Get-EnvValue -Path $EnvFile -Key "QUOTE_ASYNC_ARCHIVES_ENABLED").ToLowerInvariant()
            $asyncArchivesEnabled = @("1", "true", "yes", "on") -contains $asyncValue
            if ($asyncArchivesEnabled) {
                if (-not $health.quote_worker -or $health.quote_worker.status -ne "healthy") {
                    Start-Sleep -Seconds 1
                    continue
                }
                $queuedParts = "n/a"
                if ($health.quote_worker.PSObject.Properties.Name -contains "queued_parts") {
                    $queuedParts = $health.quote_worker.queued_parts
                }
                Write-Note ("Quote worker healthy: active={0}, queued={1}" -f $health.quote_worker.active_parts, $queuedParts)
            }
            Write-Note "API healthy: $base/api/health"
            $Script:ApiWasStopped = $false
            $Script:ApiTaskWasPaused = $false
            return
        } catch {
            Start-Sleep -Seconds 1
        }
    }

    throw "API or quote worker did not become healthy. Check API and worker runtime logs."
}

try {
    New-Item -ItemType File -Force -Path $LogPath | Out-Null
    Write-Step "Starting company PC update"
    Write-Note "ProjectRoot: $ProjectRoot"

    Ensure-RuntimeDirectories
    Resolve-PythonRuntimes
    $canCreateQuoteSnapshot = `
        -not $SkipDatabaseBackup `
        -and -not $DisableAsyncArchives `
        -and -not $SkipApiRestart `
        -and -not $SkipWorkerRestart
    if ($canCreateQuoteSnapshot) {
        Enable-QuoteMaintenance
        Wait-ForQuoteUploadsToDrain
        Stop-Api
        Stop-QuoteWorker
        Backup-QuoteJobsBeforeUpdate
        Disable-QuoteMaintenance
    }
    else {
        if (-not $SkipDatabaseBackup) {
            Write-Warn "Skipping the quote job snapshot because API and worker writes cannot both be paused with the selected switches."
        }
        if (-not $SkipApiRestart) {
            Stop-Api
        }
        else {
            Write-Warn "Leaving the currently running API unchanged because SkipApiRestart was selected."
        }
        if ($DisableAsyncArchives) {
            Write-Warn "Soft rollback requested; leaving the current quote worker and startup task unchanged."
        }
        elseif (-not $SkipWorkerRestart) {
            Stop-QuoteWorker
        }
        else {
            Write-Warn "Leaving the currently running quote worker unchanged."
        }
    }
    Backup-OrderPortalBeforeUpdate
    Pull-FrameworkChanges
    Restart-WithUpdatedScriptIfNeeded
    Ensure-RuntimeDirectories
    Test-LocalDataPresence
    Install-Dependencies
    Init-DatabaseSchema
    Configure-ArchiveRuntime
    Register-QuoteWorkerStartupTask
    Restart-QuoteWorker
    Restart-Api

    Write-Host ""
    Write-Host "Company PC update completed." -ForegroundColor Green
    Write-Host "Local API: http://127.0.0.1:$ApiPort/api/health"
    Write-Host "Async archives: $(Get-EnvValue -Path $EnvFile -Key 'QUOTE_ASYNC_ARCHIVES_ENABLED')"
    Write-Host "Rollback: rerun with -DisableAsyncArchives to route new archives to the legacy endpoint."
    Write-Host "Log: $LogPath"
} catch {
    $updateError = $_.Exception
    try {
        Disable-QuoteMaintenance
    }
    catch {
        Write-Warn "Could not remove the quote maintenance flag: $($_.Exception.Message)"
    }
    $workerRestored = $false
    if ($Script:WorkerTaskWasPaused -and $Script:WorkerTaskWasEnabled) {
        try {
            $restoreWorkerTask = Get-RootScheduledTask -TaskName $WorkerTaskName
            if ($null -eq $restoreWorkerTask) {
                throw "The quote worker task disappeared during rollback"
            }
            Assert-WorkerTaskContract -Task $restoreWorkerTask
            Enable-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
                -ErrorAction Stop | Out-Null
            Start-ScheduledTask -TaskName $WorkerTaskName -TaskPath "\" `
                -ErrorAction Stop
            for ($i = 1; $i -le 10; $i++) {
                if (Test-Path -LiteralPath $WorkerPidFile -PathType Leaf) {
                    $pidText = (Get-Content -LiteralPath $WorkerPidFile -Raw -ErrorAction SilentlyContinue).Trim()
                    $workerPid = 0
                    if ([int]::TryParse($pidText, [ref]$workerPid) -and (Get-Process -Id $workerPid -ErrorAction SilentlyContinue)) {
                        $workerRestored = $true
                        $Script:WorkerProcessWasStopped = $false
                        break
                    }
                }
                Start-Sleep -Milliseconds 500
            }
            if ($workerRestored) {
                Write-Warn "The previous quote worker startup task was re-enabled after the failed update."
            }
            else {
                Write-Warn "The worker task was re-enabled but did not start promptly; trying the supervisor directly."
            }
        }
        catch {
            Write-Warn "Could not restore the previous quote worker task: $($_.Exception.Message)"
        }
    }
    if ($Script:WorkerProcessWasStopped -and -not $DisableAsyncArchives -and -not $SkipWorkerRestart) {
        try {
            Restart-QuoteWorker
            Write-Warn "The quote worker was restarted after the failed update."
        }
        catch {
            Write-Warn "Could not restore the quote worker after the failed update: $($_.Exception.Message)"
        }
    }
    if ($Script:ApiWasStopped -and -not $SkipApiRestart) {
        try {
            Restart-Api
            Write-Warn "The API was restarted after the failed update."
        }
        catch {
            Write-Warn "Could not restore the API after the failed update: $($_.Exception.Message)"
        }
    }
    Write-Host ""
    Write-Host "Company PC update failed." -ForegroundColor Red
    Write-Host $updateError.Message -ForegroundColor Red
    Write-Host "Log: $LogPath"
    exit 1
}
