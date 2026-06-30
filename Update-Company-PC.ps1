<#
Pull framework/code changes on the company PC while preserving local data.

Usage:
  .\Update-Company-PC.ps1

This script keeps local application data untouched:
- backend/data
- backend/uploads
- backend/static/thumbnails
- backend/static/stl
- backend/.env
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$Remote = "origin",
    [string]$Branch = "",
    [string]$CondaEnvName = "occ",
    [string]$GitProxy = "",
    [int]$ApiPort = 5000,
    [switch]$SkipDependencyInstall,
    [switch]$SkipDatabaseBackup,
    [switch]$SkipInitDb,
    [switch]$SkipApiRestart
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$LogPath = Join-Path $ProjectRoot "company-update.log"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RuntimeBackupRoot = Join-Path (Join-Path $ProjectRoot "local_backups") "runtime-$Stamp"
$Script:GitProxyResolved = $false
$Script:ResolvedGitProxy = ""

function Write-Step {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line -ForegroundColor Cyan
    Add-Content -LiteralPath $LogPath -Value $line
}

function Write-Note {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -LiteralPath $LogPath -Value $line
}

function Write-Warn {
    param([string]$Message)
    $line = "[{0}] WARNING: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Warning $Message
    Add-Content -LiteralPath $LogPath -Value $line
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

    $backupDir = Join-Path $ProjectRoot "local_backups"
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
        "$env:ProgramData\anaconda3\Scripts\conda.exe"
    )

    foreach ($p in $paths | Select-Object -Unique) {
        if ($p -and (Test-Path -LiteralPath $p)) {
            return (Resolve-Path -LiteralPath $p).Path
        }
    }
    return $null
}

function Ensure-RuntimeDirectories {
    Write-Step "Ensuring runtime directories"
    $dirs = @(
        (Join-Path $BackendRoot "data"),
        (Join-Path $BackendRoot "uploads"),
        (Join-Path $BackendRoot "static\thumbnails"),
        (Join-Path $BackendRoot "static\stl")
    )
    foreach ($dir in $dirs) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Note "Directory ready: $dir"
    }
}

function Backup-LocalRuntimeState {
    Write-Step "Backing up local runtime state before git pull"
    New-Item -ItemType Directory -Force -Path $RuntimeBackupRoot | Out-Null

    $items = @(
        @{ Source = (Join-Path $BackendRoot "data"); Relative = "backend\data" },
        @{ Source = (Join-Path $BackendRoot "uploads"); Relative = "backend\uploads" },
        @{ Source = (Join-Path $BackendRoot "static\thumbnails"); Relative = "backend\static\thumbnails" },
        @{ Source = (Join-Path $BackendRoot "static\stl"); Relative = "backend\static\stl" },
        @{ Source = (Join-Path $BackendRoot ".env"); Relative = "backend\.env" }
    )

    foreach ($item in $items) {
        $src = $item.Source
        if (-not (Test-Path -LiteralPath $src)) {
            Write-Note "Runtime item not present, skipping backup: $src"
            continue
        }

        $dst = Join-Path $RuntimeBackupRoot $item.Relative
        $dstParent = Split-Path -Parent $dst
        New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
        Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
        Write-Note "Backed up runtime item: $src"
    }

    Write-Note "Runtime backup root: $RuntimeBackupRoot"
}

function Restore-LocalRuntimeState {
    Write-Step "Restoring local runtime state after git pull"
    if (-not (Test-Path -LiteralPath $RuntimeBackupRoot)) {
        Write-Warn "Runtime backup root not found: $RuntimeBackupRoot"
        return
    }

    $items = @(
        @{ Source = (Join-Path $RuntimeBackupRoot "backend\data"); Target = (Join-Path $BackendRoot "data") },
        @{ Source = (Join-Path $RuntimeBackupRoot "backend\uploads"); Target = (Join-Path $BackendRoot "uploads") },
        @{ Source = (Join-Path $RuntimeBackupRoot "backend\static\thumbnails"); Target = (Join-Path $BackendRoot "static\thumbnails") },
        @{ Source = (Join-Path $RuntimeBackupRoot "backend\static\stl"); Target = (Join-Path $BackendRoot "static\stl") }
    )

    foreach ($item in $items) {
        $src = $item.Source
        $target = $item.Target
        if (-not (Test-Path -LiteralPath $src)) {
            continue
        }
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Get-ChildItem -LiteralPath $src -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
        }
        Write-Note "Restored runtime folder: $target"
    }

    $envBackup = Join-Path $RuntimeBackupRoot "backend\.env"
    if (Test-Path -LiteralPath $envBackup) {
        Copy-Item -LiteralPath $envBackup -Destination (Join-Path $BackendRoot ".env") -Force
        Write-Note "Restored backend .env"
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

function Backup-Database {
    if ($SkipDatabaseBackup) {
        Write-Warn "Skipping database backup."
        return
    }

    $db = Join-Path $BackendRoot "data\daiyujin.db"
    if (-not (Test-Path -LiteralPath $db)) {
        Write-Warn "Database not found at $db. Skipping backup."
        return
    }

    $backupDir = Join-Path $ProjectRoot "local_backups"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $backupPath = Join-Path $backupDir "daiyujin-$Stamp.db"
    Copy-Item -LiteralPath $db -Destination $backupPath -Force
    Write-Note "Database backup created: $backupPath"
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

function Install-Dependencies {
    if ($SkipDependencyInstall) {
        Write-Warn "Skipping dependency install."
        return
    }

    $conda = Find-Conda
    if (-not $conda) {
        throw "Conda was not found. Run Setup-Company-PC.ps1 first."
    }

    $requirements = Join-Path $BackendRoot "requirements.txt"
    Run-Native -FilePath $conda -Arguments @("run", "-n", $CondaEnvName, "python", "-m", "pip", "install", "-r", $requirements) -Name "Installing/updating Python dependencies"
}

function Init-DatabaseSchema {
    if ($SkipInitDb) {
        Write-Warn "Skipping init_db."
        return
    }

    $conda = Find-Conda
    if (-not $conda) {
        throw "Conda was not found. Run Setup-Company-PC.ps1 first."
    }

    $initScript = Join-Path $BackendRoot "scripts\init_db.py"
    if (Test-Path -LiteralPath $initScript) {
        Run-Native -FilePath $conda -Arguments @("run", "-n", $CondaEnvName, "python", $initScript) -Name "Applying additive database schema updates"
    }
}

function Restart-Api {
    if ($SkipApiRestart) {
        Write-Warn "Skipping API restart."
        return
    }

    Write-Step "Restarting local API"

    try {
        $connections = @(Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue)
        foreach ($conn in $connections) {
            Write-Note "Stopping process $($conn.OwningProcess) on 127.0.0.1:$ApiPort"
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Warn "Could not query/stop existing API process: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 1

    $runApi = Join-Path $ProjectRoot "run-api.ps1"
    if (-not (Test-Path -LiteralPath $runApi)) {
        throw "run-api.ps1 not found: $runApi"
    }

    $outLog = Join-Path $ProjectRoot "api-runtime.out.log"
    $errLog = Join-Path $ProjectRoot "api-runtime.err.log"

    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runApi) `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog | Out-Null

    $base = "http://127.0.0.1:$ApiPort"
    for ($i = 1; $i -le 30; $i++) {
        try {
            Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5 | Out-Null
            Write-Note "API healthy: $base/api/health"
            return
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    throw "API did not become healthy. Check $outLog and $errLog."
}

try {
    New-Item -ItemType File -Force -Path $LogPath | Out-Null
    Write-Step "Starting company PC update"
    Write-Note "ProjectRoot: $ProjectRoot"

    Ensure-RuntimeDirectories
    Backup-LocalRuntimeState
    Backup-Database
    Pull-FrameworkChanges
    Restore-LocalRuntimeState
    Ensure-RuntimeDirectories
    Test-LocalDataPresence
    Install-Dependencies
    Init-DatabaseSchema
    Restart-Api

    Write-Host ""
    Write-Host "Company PC update completed." -ForegroundColor Green
    Write-Host "Local API: http://127.0.0.1:$ApiPort/api/health"
    Write-Host "Log: $LogPath"
} catch {
    Write-Host ""
    Write-Host "Company PC update failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Log: $LogPath"
    exit 1
}
