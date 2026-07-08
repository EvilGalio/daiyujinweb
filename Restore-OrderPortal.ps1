<#
Restores an Order Portal backup package created by Backup-OrderPortal.ps1.

Examples:
  $env:ORDER_PORTAL_BACKUP_PASSWORD = "your-strong-password"
  .\Restore-OrderPortal.ps1 -BackupZip "D:\DaiyujinBackups\order_portal\daily\order-portal-daily-20260708-023000.zip" -DryRun
  .\Restore-OrderPortal.ps1 -BackupZip "D:\DaiyujinBackups\order_portal\daily\order-portal-daily-20260708-023000.zip" -IHaveStoppedApi
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupZip,

    [string]$ProjectRoot = "",
    [string]$BackupRoot = "",
    [string]$PythonExe = "",
    [string]$SevenZipPath = "",

    [switch]$RestoreEnv,
    [bool]$RestoreLocalMedia = $true,
    [switch]$DryRun,
    [switch]$IHaveStoppedApi,
    [switch]$StartApiAfterRestore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Resolve-DefaultProjectRoot {
    if ($ProjectRoot) {
        return (Resolve-Path -LiteralPath $ProjectRoot).Path
    }
    $companyRoot = "C:\daiyujin\daiyujinweb"
    if (Test-Path -LiteralPath $companyRoot) {
        return $companyRoot
    }
    return $PSScriptRoot
}

$ProjectRoot = Resolve-DefaultProjectRoot
if (-not $BackupRoot) {
    $BackupRoot = Join-Path (Join-Path $ProjectRoot "local_backups") "order_portal"
}

$BackendRoot = Join-Path $ProjectRoot "backend"
$DbPath = Join-Path $BackendRoot "data\daiyujin.db"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RestoreRoot = Join-Path (Join-Path $BackupRoot "restore_tests") "restore-$Stamp"
$ExtractRoot = Join-Path $RestoreRoot "extract"
$LogDir = Join-Path $BackupRoot "logs"
$LogPath = Join-Path $LogDir "restore-$Stamp.log"

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Write-Log([string]$Message, [string]$Level = "INFO") {
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    Ensure-Directory $LogDir
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-FileSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Resolve-PythonExe {
    if ($PythonExe) {
        if (Test-Path -LiteralPath $PythonExe) { return $PythonExe }
        throw "PythonExe not found: $PythonExe"
    }
    $envPath = Join-Path $BackendRoot ".env"
    if (Test-Path -LiteralPath $envPath) {
        $line = Select-String -LiteralPath $envPath -Pattern "^OCC_PYTHON=" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($line) {
            $candidate = $line.Line.Split("=", 2)[1].Trim().Trim('"')
            if (Test-Path -LiteralPath $candidate) { return $candidate }
        }
    }
    $candidates = @(
        "D:\anaconda\python.exe",
        "C:\Users\$env:USERNAME\miniconda3\python.exe",
        "C:\Users\$env:USERNAME\miniconda3\envs\occ\python.exe",
        "C:\Users\$env:USERNAME\anaconda3\python.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "Unable to find Python. Pass -PythonExe or set OCC_PYTHON in backend\.env."
}

function Resolve-SevenZip {
    if ($SevenZipPath) {
        if (Test-Path -LiteralPath $SevenZipPath) { return $SevenZipPath }
        throw "SevenZipPath not found: $SevenZipPath"
    }
    $candidates = @(
        "C:\Program Files\7-Zip\7z.exe",
        "C:\Program Files (x86)\7-Zip\7z.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $cmd = Get-Command "7z.exe" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "7-Zip not found. Install 7-Zip or pass -SevenZipPath."
}

function Get-BackupPassword {
    $password = [Environment]::GetEnvironmentVariable("ORDER_PORTAL_BACKUP_PASSWORD", "Process")
    if (-not $password) {
        $password = [Environment]::GetEnvironmentVariable("ORDER_PORTAL_BACKUP_PASSWORD", "User")
    }
    if (-not $password) {
        $password = [Environment]::GetEnvironmentVariable("ORDER_PORTAL_BACKUP_PASSWORD", "Machine")
    }
    if (-not $password) {
        throw "ORDER_PORTAL_BACKUP_PASSWORD is not set. Cannot decrypt backup."
    }
    return $password
}

function Format-ArgumentsForLog([string[]]$Arguments) {
    return @($Arguments | ForEach-Object {
        if ($_ -like "-p*") { "-p********" } else { $_ }
    })
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments, [string]$Name) {
    $safeArgs = Format-ArgumentsForLog $Arguments
    Write-Log "Command: $FilePath $($safeArgs -join ' ')" "DEBUG"
    & $FilePath @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "$Name failed with exit code $code"
    }
}

function Expand-EncryptedZip([string]$ZipPath, [string]$OutputPath) {
    if (-not (Test-Path -LiteralPath $ZipPath)) {
        throw "Backup zip not found: $ZipPath"
    }
    Ensure-Directory $OutputPath
    $sevenZip = Resolve-SevenZip
    $password = Get-BackupPassword
    Invoke-Native -FilePath $sevenZip -Arguments @("x", $ZipPath, "-o$OutputPath", "-p$password", "-y") -Name "7-Zip extract"
}

function Invoke-SqliteCheck([string]$DatabasePath, [string]$MetaPath) {
    if (-not (Test-Path -LiteralPath $DatabasePath)) {
        throw "Restored database not found: $DatabasePath"
    }
    $py = Resolve-PythonExe
    $scriptPath = Join-Path $RestoreRoot "sqlite_check.py"
    $code = @'
import argparse
import json
import os
import sqlite3
from datetime import datetime

REQUIRED = [
    "portal_users",
    "portal_orders",
    "portal_order_updates",
    "portal_order_media",
    "portal_messages",
    "portal_events",
]

parser = argparse.ArgumentParser()
parser.add_argument("--db", required=True)
parser.add_argument("--meta", required=True)
args = parser.parse_args()

con = sqlite3.connect(args.db)
try:
    existing = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = [table for table in REQUIRED if table not in existing]
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    counts = {}
    for table in REQUIRED:
        counts[table] = None if table not in existing else con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
finally:
    con.close()

meta = {
    "checked_at": datetime.now().astimezone().isoformat(),
    "db": args.db,
    "db_size_bytes": os.path.getsize(args.db),
    "sqlite_integrity_check": integrity,
    "missing_tables": missing,
    "table_counts": counts,
}
with open(args.meta, "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
if missing:
    raise SystemExit("Missing required portal tables: " + ", ".join(missing))
if integrity != "ok":
    raise SystemExit("SQLite integrity_check failed: " + integrity)
'@
    Set-Content -LiteralPath $scriptPath -Value $code -Encoding UTF8
    Invoke-Native -FilePath $py -Arguments @("-B", $scriptPath, "--db", $DatabasePath, "--meta", $MetaPath) -Name "SQLite restore check"
}

function Invoke-SqliteBackup([string]$SourceDb, [string]$OutputDb) {
    if (-not (Test-Path -LiteralPath $SourceDb)) {
        Write-Log "Current database not found, skipping pre-restore DB backup: $SourceDb" "WARN"
        return
    }
    Ensure-Directory (Split-Path -Parent $OutputDb)
    $py = Resolve-PythonExe
    $scriptPath = Join-Path $RestoreRoot "sqlite_backup.py"
    $code = @'
import argparse
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()

src = sqlite3.connect(args.source)
dst = sqlite3.connect(args.output)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()
'@
    Set-Content -LiteralPath $scriptPath -Value $code -Encoding UTF8
    Invoke-Native -FilePath $py -Arguments @("-B", $scriptPath, "--source", $SourceDb, "--output", $OutputDb) -Name "SQLite pre-restore backup"
}

function Copy-IfExists([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) {
        Write-Log "Optional item not found, skipping: $Source" "WARN"
        return
    }
    Ensure-Directory (Split-Path -Parent $Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Compress-EncryptedZip([string]$SourceFolder, [string]$ZipPath) {
    $sevenZip = Resolve-SevenZip
    $password = Get-BackupPassword
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    Ensure-Directory (Split-Path -Parent $ZipPath)
    $sourceGlob = Join-Path $SourceFolder "*"
    Invoke-Native -FilePath $sevenZip -Arguments @("a", "-tzip", $ZipPath, $sourceGlob, "-p$password", "-mem=AES256", "-mx=5", "-y") -Name "7-Zip pre-restore archive"
}

function New-PreRestoreBackup {
    $preDir = Join-Path $BackupRoot "pre_restore"
    Ensure-Directory $preDir
    $prePayload = Join-Path $RestoreRoot "pre_restore_payload"
    Ensure-Directory $prePayload

    Invoke-SqliteBackup -SourceDb $DbPath -OutputDb (Join-Path $prePayload "backend\data\daiyujin.db")
    Copy-IfExists -Source (Join-Path $BackendRoot ".env") -Destination (Join-Path $prePayload "backend\.env")
    Copy-IfExists -Source (Join-Path $BackendRoot "private\order_media") -Destination (Join-Path $prePayload "backend\private\order_media")
    Copy-IfExists -Source (Join-Path $BackendRoot "uploads") -Destination (Join-Path $prePayload "backend\uploads")
    Copy-IfExists -Source (Join-Path $BackendRoot "static\thumbnails") -Destination (Join-Path $prePayload "backend\static\thumbnails")
    Copy-IfExists -Source (Join-Path $BackendRoot "static\stl") -Destination (Join-Path $prePayload "backend\static\stl")

    $preZip = Join-Path $preDir "pre-restore-$Stamp.zip"
    Compress-EncryptedZip -SourceFolder $prePayload -ZipPath $preZip
    Write-Log "Pre-restore backup created: $preZip"
}

function Restore-DirectoryFromPayload([string]$RelativePath, [string]$TargetPath) {
    $source = Join-Path $ExtractRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source)) {
        Write-Log "Backup does not include $RelativePath, skipping restore for $TargetPath" "WARN"
        return
    }
    if (Test-Path -LiteralPath $TargetPath) {
        Remove-Item -LiteralPath $TargetPath -Recurse -Force
    }
    Ensure-Directory (Split-Path -Parent $TargetPath)
    Copy-Item -LiteralPath $source -Destination $TargetPath -Recurse -Force
    Write-Log "Restored folder: $TargetPath"
}

function Restore-Database {
    $sourceDb = Join-Path $ExtractRoot "backend\data\daiyujin.db"
    if (-not (Test-Path -LiteralPath $sourceDb)) {
        throw "Backup payload missing backend\data\daiyujin.db"
    }
    Ensure-Directory (Split-Path -Parent $DbPath)
    Copy-Item -LiteralPath $sourceDb -Destination $DbPath -Force
    foreach ($suffix in @("-wal", "-shm")) {
        $sidecar = "$DbPath$suffix"
        if (Test-Path -LiteralPath $sidecar) {
            Remove-Item -LiteralPath $sidecar -Force
        }
    }
    Write-Log "Restored database: $DbPath"
}

function Get-SidecarManifestPath([string]$ZipPath) {
    $dir = Split-Path -Parent $ZipPath
    $base = [System.IO.Path]::GetFileNameWithoutExtension($ZipPath)
    return Join-Path $dir ($base + ".manifest.json")
}

function Test-ZipHashAgainstManifest([string]$ZipPath) {
    $manifestPath = Get-SidecarManifestPath $ZipPath
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        Write-Log "Sidecar manifest not found, skipping package hash verification: $manifestPath" "WARN"
        return
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $fileName = Split-Path -Leaf $ZipPath
    $actual = Get-FileSha256 $ZipPath
    $expected = $null
    if ($manifest.sha256 -and $manifest.sha256.PSObject.Properties[$fileName]) {
        $expected = [string]$manifest.sha256.$fileName
    }
    if (-not $expected) {
        Write-Log "Manifest has no sha256 entry for $fileName, skipping hash verification" "WARN"
        return
    }
    if ($actual -ne $expected.ToLowerInvariant()) {
        throw "Backup hash mismatch. Expected $expected, got $actual"
    }
    Write-Log "Backup hash verified: $actual"
}

try {
    Ensure-Directory $RestoreRoot
    Ensure-Directory $LogDir
    Write-Log "Starting Order Portal restore"
    Write-Log "ProjectRoot: $ProjectRoot"
    Write-Log "BackupZip:   $BackupZip"
    Write-Log "DryRun:      $DryRun"

    Test-ZipHashAgainstManifest -ZipPath $BackupZip
    Expand-EncryptedZip -ZipPath $BackupZip -OutputPath $ExtractRoot

    $restoredDb = Join-Path $ExtractRoot "backend\data\daiyujin.db"
    Invoke-SqliteCheck -DatabasePath $restoredDb -MetaPath (Join-Path $RestoreRoot "restore-check.json")

    if ($DryRun) {
        Write-Log "Dry-run restore check succeeded. No production files were changed."
        Write-Log "Extracted payload: $ExtractRoot"
        return
    }

    if (-not $IHaveStoppedApi) {
        throw "Stop the API first, then rerun with -IHaveStoppedApi. This prevents restoring while SQLite is active."
    }

    New-PreRestoreBackup
    Restore-Database

    if ($RestoreEnv) {
        $envSource = Join-Path $ExtractRoot "backend\.env"
        if (Test-Path -LiteralPath $envSource) {
            Copy-Item -LiteralPath $envSource -Destination (Join-Path $BackendRoot ".env") -Force
            Write-Log "Restored backend\.env"
        } else {
            Write-Log "Backup does not include backend\.env" "WARN"
        }
    } else {
        Write-Log "Skipped backend\.env restore. Pass -RestoreEnv to restore it."
    }

    if ($RestoreLocalMedia) {
        Restore-DirectoryFromPayload -RelativePath "backend\private\order_media" -TargetPath (Join-Path $BackendRoot "private\order_media")
        Restore-DirectoryFromPayload -RelativePath "backend\uploads" -TargetPath (Join-Path $BackendRoot "uploads")
        Restore-DirectoryFromPayload -RelativePath "backend\static\thumbnails" -TargetPath (Join-Path $BackendRoot "static\thumbnails")
        Restore-DirectoryFromPayload -RelativePath "backend\static\stl" -TargetPath (Join-Path $BackendRoot "static\stl")
    } else {
        Write-Log "Skipped local media/runtime folder restore."
    }

    Write-Log "Restore completed."

    if ($StartApiAfterRestore) {
        $startApi = Join-Path $ProjectRoot "start-api.bat"
        if (Test-Path -LiteralPath $startApi) {
            Start-Process -FilePath $startApi -WorkingDirectory $ProjectRoot -WindowStyle Hidden
            Write-Log "Started API via start-api.bat"
        } else {
            Write-Log "start-api.bat not found: $startApi" "WARN"
        }
    } else {
        Write-Log "Start API manually: .\start-api.bat"
    }
}
catch {
    Write-Log $_.Exception.Message "ERROR"
    throw
}
