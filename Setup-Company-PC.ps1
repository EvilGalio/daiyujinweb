<#
Company PC setup script for Daiyujin backend.

Run from the project root on the company PC:

  cd C:\Daiyujin\daiyujinweb
  Set-ExecutionPolicy -Scope Process Bypass -Force
  .\Setup-Company-PC.ps1 -TunnelToken "PASTE_CLOUDFLARE_TUNNEL_TOKEN_HERE"

If you do not have the Cloudflare token yet:

  .\Setup-Company-PC.ps1

The script is intentionally non-destructive:
- It does not delete databases.
- It backs up existing startup scripts before rewriting them.
- It skips Cloudflared service installation if a Cloudflared service already exists.
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = $PSScriptRoot,
    [string]$CondaEnvName = "occ",
    [string]$PythonVersion = "3.11",
    [int]$ApiPort = 5000,
    [string]$AllowedOrigins = "https://gcnov.com,https://daiyujin.dpdns.org,http://daiyujin.dpdns.org",
    [string]$TunnelToken = "",
    [switch]$SkipSoftwareInstall,
    [switch]$SkipCloudflaredInstall,
    [switch]$SkipScheduledTask,
    [switch]$SkipApiSmokeTest
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$BackendRoot = Join-Path $ProjectRoot "backend"
$LogPath = Join-Path $ProjectRoot "setup-company-pc.log"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"

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

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Run-Native {
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments,
        [Parameter(Mandatory=$true)][string]$Name
    )

    Write-Step $Name
    Write-Note ("Command: {0} {1}" -f $FilePath, ($Arguments -join " "))
    & $FilePath @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Get-CommandPath {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    return $null
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

function Find-Cloudflared {
    $paths = @()
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { $paths += $cmd.Source }

    $paths += @(
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    )

    foreach ($p in $paths | Select-Object -Unique) {
        if ($p -and (Test-Path -LiteralPath $p)) {
            return (Resolve-Path -LiteralPath $p).Path
        }
    }

    $wingetRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    if (Test-Path -LiteralPath $wingetRoot) {
        $found = Get-ChildItem -LiteralPath $wingetRoot -Recurse -Filter "cloudflared.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }

    return $null
}

function Backup-FileIfExists {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        $backup = "$Path.bak-$Stamp"
        Copy-Item -LiteralPath $Path -Destination $backup -Force
        Write-Note "Backed up $Path to $backup"
    }
}

function Ensure-WingetPackage {
    param(
        [string]$PackageId,
        [string]$DisplayName,
        [string]$CheckCommand
    )

    if (Get-Command $CheckCommand -ErrorAction SilentlyContinue) {
        Write-Note "$DisplayName already available."
        return
    }

    if ($SkipSoftwareInstall) {
        Write-Warn "$DisplayName is missing, and -SkipSoftwareInstall is set."
        return
    }

    $winget = Get-CommandPath "winget"
    if (-not $winget) {
        throw "winget is not available. Install $DisplayName manually, then rerun this script."
    }

    Run-Native -FilePath $winget -Arguments @(
        "install",
        "--id", $PackageId,
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements"
    ) -Name "Installing $DisplayName"
}

function Ensure-ProjectFiles {
    Write-Step "Checking project files"

    $required = @(
        (Join-Path $BackendRoot "app.py"),
        (Join-Path $BackendRoot "requirements.txt"),
        (Join-Path $BackendRoot "scripts\analyze_step_cli.py"),
        (Join-Path $BackendRoot "scripts\export_stl_cli.py"),
        (Join-Path $BackendRoot "services")
    )

    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Required project file/folder is missing: $path. Copy the full project to C:\Daiyujin\daiyujinweb first."
        }
    }

    $db = Join-Path $BackendRoot "data\daiyujin.db"
    if (Test-Path -LiteralPath $db) {
        $dbSize = (Get-Item -LiteralPath $db).Length
        Write-Note "Database found: $db ($dbSize bytes)"
        if ($dbSize -eq 0) {
            Write-Warn "Database file exists but is empty. The real migrated database should normally be backend\data\daiyujin.db from the old PC."
        }
    } else {
        Write-Warn "Database not found at $db. The script can initialize tables, but migrated inquiry/history data will be missing."
    }
}

function Ensure-RuntimeDirectories {
    Write-Step "Creating runtime directories"
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

function Ensure-Software {
    Write-Step "Checking base software"
    Ensure-WingetPackage -PackageId "Git.Git" -DisplayName "Git" -CheckCommand "git"

    $conda = Find-Conda
    if (-not $conda) {
        Ensure-WingetPackage -PackageId "Anaconda.Miniconda3" -DisplayName "Miniconda" -CheckCommand "conda"
        $conda = Find-Conda
    }
    if (-not $conda) {
        throw "Conda was not found after installation. Open a new Administrator PowerShell and rerun this script."
    }
    Write-Note "Conda found: $conda"

    if (-not $SkipCloudflaredInstall) {
        $cloudflared = Find-Cloudflared
        if (-not $cloudflared) {
            Ensure-WingetPackage -PackageId "Cloudflare.cloudflared" -DisplayName "cloudflared" -CheckCommand "cloudflared"
            $cloudflared = Find-Cloudflared
        }
        if ($cloudflared) {
            Write-Note "cloudflared found: $cloudflared"
        } else {
            Write-Warn "cloudflared was not found. Install it manually or rerun without -SkipCloudflaredInstall."
        }
    }

    return $conda
}

function Ensure-CondaEnvironment {
    param([string]$CondaPath)

    Write-Step "Checking Conda environment"
    $envJsonRaw = & $CondaPath env list --json
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query Conda environments."
    }
    $envJson = $envJsonRaw | ConvertFrom-Json
    $envExists = $false
    foreach ($envPath in $envJson.envs) {
        if ((Split-Path -Leaf $envPath) -eq $CondaEnvName) {
            $envExists = $true
            break
        }
    }

    if (-not $envExists) {
        Run-Native -FilePath $CondaPath -Arguments @("create", "-n", $CondaEnvName, "python=$PythonVersion", "-y") -Name "Creating Conda env $CondaEnvName"
    } else {
        Write-Note "Conda env already exists: $CondaEnvName"
    }

    Run-Native -FilePath $CondaPath -Arguments @("install", "-n", $CondaEnvName, "-c", "conda-forge", "pythonocc-core", "-y") -Name "Installing pythonocc-core"

    $requirements = Join-Path $BackendRoot "requirements.txt"
    Run-Native -FilePath $CondaPath -Arguments @("run", "-n", $CondaEnvName, "python", "-m", "pip", "install", "--upgrade", "pip") -Name "Upgrading pip"
    Run-Native -FilePath $CondaPath -Arguments @("run", "-n", $CondaEnvName, "python", "-m", "pip", "install", "-r", $requirements) -Name "Installing backend Python packages"

    Run-Native -FilePath $CondaPath -Arguments @("run", "-n", $CondaEnvName, "python", "-c", "import OCC; print('OCC ok')") -Name "Testing OCC import"
    Run-Native -FilePath $CondaPath -Arguments @("run", "-n", $CondaEnvName, "python", "-c", "import flask, sqlalchemy, waitress; print('web deps ok')") -Name "Testing web dependencies"

    $occPythonRaw = & $CondaPath run -n $CondaEnvName python -c "import sys; print(sys.executable)"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to resolve OCC Python path."
    }
    $occPython = ($occPythonRaw | Select-Object -Last 1).Trim()
    if (-not (Test-Path -LiteralPath $occPython)) {
        throw "Resolved OCC Python path does not exist: $occPython"
    }

    Write-Note "OCC Python: $occPython"
    return $occPython
}

function Write-BackendEnv {
    param([string]$OccPython)

    Write-Step "Writing backend .env"
    $envPath = Join-Path $BackendRoot ".env"
    Backup-FileIfExists -Path $envPath
    Set-Content -LiteralPath $envPath -Encoding UTF8 -Value ("OCC_PYTHON={0}" -f $OccPython)
    Write-Note "Wrote $envPath"
}

function Write-StartupScripts {
    param([string]$OccPython)

    Write-Step "Writing startup scripts"

    $runApiPath = Join-Path $ProjectRoot "run-api.ps1"
    $startApiPath = Join-Path $ProjectRoot "start-api.bat"
    $startTunnelPath = Join-Path $ProjectRoot "start-tunnel.bat"

    Backup-FileIfExists -Path $runApiPath
    Backup-FileIfExists -Path $startApiPath
    Backup-FileIfExists -Path $startTunnelPath

    $runApi = @"
`$ErrorActionPreference = "Stop"

`$ProjectRoot = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$BackendRoot = Join-Path `$ProjectRoot "backend"
`$OccPython = "$OccPython"
`$ApiPort = $ApiPort

Set-Location `$BackendRoot

`$dbPath = (Join-Path `$BackendRoot "data\daiyujin.db").Replace("\", "/")
`$env:DATABASE_URL = "sqlite:///`$dbPath"
`$env:OCC_PYTHON = `$OccPython
`$env:ALLOWED_ORIGINS = "$AllowedOrigins"

`$listen = "127.0.0.1:`$ApiPort"
& `$OccPython -m waitress "--listen=`$listen" app:app
"@
    Set-Content -LiteralPath $runApiPath -Encoding UTF8 -Value $runApi

    $startApi = @"
@echo off
title Daiyujin API Server
cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:$ApiPort" ^| findstr "LISTENING"') do (
    echo Killing old process %%a on port $ApiPort...
    taskkill /F /PID %%a 2>nul
)

timeout /t 1 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-api.ps1"
pause
"@
    Set-Content -LiteralPath $startApiPath -Encoding ASCII -Value $startApi

    if (Test-Path -LiteralPath $startTunnelPath) {
        $tunnelContent = Get-Content -LiteralPath $startTunnelPath -Raw
        $tunnelContent = $tunnelContent -replace 'cd /d D:\\myfirstgithubcode\\daiyujinweb', 'cd /d "%~dp0"'
        Set-Content -LiteralPath $startTunnelPath -Encoding ASCII -Value $tunnelContent
    }

    Write-Note "Wrote $runApiPath"
    Write-Note "Wrote $startApiPath"
    if (Test-Path -LiteralPath $startTunnelPath) {
        Write-Note "Adjusted $startTunnelPath"
    }
}

function Initialize-DatabaseIfMissing {
    param([string]$CondaPath)

    $db = Join-Path $BackendRoot "data\daiyujin.db"
    if (Test-Path -LiteralPath $db) {
        $size = (Get-Item -LiteralPath $db).Length
        if ($size -gt 0) {
            Write-Note "Existing database preserved: $db"
            return
        }
    }

    Write-Warn "Database is missing or empty. Initializing a fresh database."
    $initScript = Join-Path $BackendRoot "scripts\init_db.py"
    $seedScript = Join-Path $BackendRoot "scripts\seed_data.py"
    $freightScript = Join-Path $BackendRoot "scripts\import_freight_v2.py"

    if (Test-Path -LiteralPath $initScript) {
        Run-Native -FilePath $CondaPath -Arguments @("run", "-n", $CondaEnvName, "python", $initScript) -Name "Initializing database"
    }
    if (Test-Path -LiteralPath $seedScript) {
        Run-Native -FilePath $CondaPath -Arguments @("run", "-n", $CondaEnvName, "python", $seedScript) -Name "Seeding database"
    }
    if (Test-Path -LiteralPath $freightScript) {
        Run-Native -FilePath $CondaPath -Arguments @("run", "-n", $CondaEnvName, "python", $freightScript) -Name "Importing freight data"
    }
}

function Ensure-ScheduledTask {
    if ($SkipScheduledTask) {
        Write-Warn "Skipping scheduled task creation."
        return
    }

    Write-Step "Creating scheduled task for API startup"

    $taskName = "Daiyujin API"
    $runApiPath = Join-Path $ProjectRoot "run-api.ps1"
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $runApiPath) `
        -WorkingDirectory $ProjectRoot

    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Runs Daiyujin backend API at user logon." -Force | Out-Null

    Write-Note "Scheduled task ready: $taskName"
}

function Install-TunnelServiceIfTokenProvided {
    if ($SkipCloudflaredInstall) {
        Write-Warn "Skipping Cloudflared service installation."
        return
    }

    if ([string]::IsNullOrWhiteSpace($TunnelToken)) {
        Write-Warn "No -TunnelToken provided. Cloudflared is installed if possible, but the tunnel service is not configured."
        Write-Warn "Create a Cloudflare Tunnel in the dashboard, copy the token command, then rerun this script with -TunnelToken."
        return
    }

    Write-Step "Installing Cloudflared service from token"

    $existingService = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-Warn "Cloudflared service already exists. This script will not overwrite it. If it is the wrong tunnel, uninstall it manually first."
        return
    }

    $cloudflared = Find-Cloudflared
    if (-not $cloudflared) {
        throw "cloudflared executable not found. Install cloudflared and rerun this script."
    }

    Run-Native -FilePath $cloudflared -Arguments @("service", "install", $TunnelToken) -Name "Installing Cloudflared Windows service"
    Start-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
    Write-Note "Cloudflared service installed."
}

function Start-ApiAndSmokeTest {
    if ($SkipApiSmokeTest) {
        Write-Warn "Skipping API smoke test."
        return
    }

    Write-Step "Starting API and running smoke tests"

    $runApiPath = Join-Path $ProjectRoot "run-api.ps1"
    $apiOut = Join-Path $ProjectRoot "api-runtime.out.log"
    $apiErr = Join-Path $ProjectRoot "api-runtime.err.log"

    $alreadyListening = $false
    try {
        $connection = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($connection) { $alreadyListening = $true }
    } catch {
        $alreadyListening = $false
    }

    if (-not $alreadyListening) {
        Start-Process `
            -FilePath "powershell.exe" `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $runApiPath) `
            -WorkingDirectory $ProjectRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $apiOut `
            -RedirectStandardError $apiErr | Out-Null
    } else {
        Write-Note "Port $ApiPort is already listening; using existing API process for smoke tests."
    }

    $base = "http://127.0.0.1:$ApiPort"
    $healthOk = $false
    for ($i = 1; $i -le 30; $i++) {
        try {
            Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5 | Out-Null
            $healthOk = $true
            break
        } catch {
            Start-Sleep -Seconds 2
        }
    }

    if (-not $healthOk) {
        Write-Warn "API health check failed. Check logs:"
        Write-Warn $apiOut
        Write-Warn $apiErr
        throw "API did not become healthy at $base/api/health"
    }

    $endpoints = @(
        "/api/health",
        "/api/public/quote/options",
        "/api/public/freight/countries",
        "/api/public/material-weight/options",
        "/api/public/tolerance/capabilities"
    )

    foreach ($endpoint in $endpoints) {
        Invoke-RestMethod -Uri "$base$endpoint" -TimeoutSec 20 | Out-Null
        Write-Note "OK: $base$endpoint"
    }
}

function Show-FinalInstructions {
    Write-Host ""
    Write-Host "Setup completed." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next checks:"
    Write-Host "  1. Local API:  http://127.0.0.1:$ApiPort/api/health"
    Write-Host "  2. Cloudflare Dashboard tunnel status should be Healthy."
    Write-Host "  3. Public hostname Service URL must be http://127.0.0.1:$ApiPort"
    Write-Host "  4. Public API: https://daiyujin.dpdns.org/api/health"
    Write-Host ""
    Write-Host "Log file:"
    Write-Host "  $LogPath"
}

try {
    New-Item -ItemType File -Force -Path $LogPath | Out-Null
    Write-Step "Starting company PC setup"
    Write-Note "ProjectRoot: $ProjectRoot"
    Write-Note "BackendRoot: $BackendRoot"

    if (-not (Test-IsAdmin)) {
        Write-Warn "This PowerShell is not running as Administrator. Software install, Cloudflared service install, or scheduled task registration may fail."
    }

    Ensure-ProjectFiles
    Ensure-RuntimeDirectories
    $condaPath = Ensure-Software
    $occPythonPath = Ensure-CondaEnvironment -CondaPath $condaPath
    Write-BackendEnv -OccPython $occPythonPath
    Write-StartupScripts -OccPython $occPythonPath
    Initialize-DatabaseIfMissing -CondaPath $condaPath
    Install-TunnelServiceIfTokenProvided
    Ensure-ScheduledTask
    Start-ApiAndSmokeTest
    Show-FinalInstructions
} catch {
    Write-Host ""
    Write-Host "Setup failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Log file:"
    Write-Host "  $LogPath"
    exit 1
}
