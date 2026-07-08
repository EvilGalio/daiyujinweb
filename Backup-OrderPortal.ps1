<#
Creates encrypted, Syncthing-friendly Order Portal backup packages.

Recommended synced folder:
  C:\daiyujin\daiyujinweb\local_backups\order_portal

Examples:
  $env:ORDER_PORTAL_BACKUP_PASSWORD = "your-strong-password"
  .\Backup-OrderPortal.ps1 -Mode Daily
  .\Backup-OrderPortal.ps1 -CleanLegacyBackups -DryRun
  .\Backup-OrderPortal.ps1 -InstallTask   # installs daily, weekly, and monthly tasks
#>

[CmdletBinding()]
param(
    [ValidateSet("Daily", "Weekly", "Monthly")]
    [string]$Mode = "Daily",

    [string]$ProjectRoot = "",
    [string]$BackupRoot = "",
    [string]$PythonExe = "",
    [string]$SevenZipPath = "",

    [switch]$CleanLegacyBackups,
    [switch]$DryRun,
    [switch]$InstallTask,
    [switch]$InstallWeeklyTask,
    [switch]$InstallMonthlyTask,

    [int]$DailyKeep = 14,
    [int]$WeeklyKeep = 8,
    [int]$MonthlyKeep = 12
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
$DataRoot = Join-Path $BackendRoot "data"
$DbPath = Join-Path $DataRoot "daiyujin.db"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ModeLower = $Mode.ToLowerInvariant()
$RunRoot = Join-Path (Join-Path $ProjectRoot ".tmp") "order-portal-backup-$Stamp"
$PayloadRoot = Join-Path $RunRoot "payload"
$LogDir = Join-Path $BackupRoot "logs"
$LogPath = Join-Path $LogDir "backup-$Stamp.log"

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

function Get-RelativePathSafe([string]$Base, [string]$Path) {
    $baseUri = [System.Uri]::new((Resolve-Path -LiteralPath $Base).Path.TrimEnd("\") + "\")
    $pathUri = [System.Uri]::new((Resolve-Path -LiteralPath $Path).Path)
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace("/", "\")
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
        throw "ORDER_PORTAL_BACKUP_PASSWORD is not set. Refusing to create unencrypted backups."
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

function Invoke-SqliteBackup([string]$SourceDb, [string]$OutputDb, [string]$MetaPath) {
    if (-not (Test-Path -LiteralPath $SourceDb)) {
        throw "SQLite database not found: $SourceDb"
    }
    Ensure-Directory (Split-Path -Parent $OutputDb)
    Ensure-Directory (Split-Path -Parent $MetaPath)

    $py = Resolve-PythonExe
    $scriptPath = Join-Path $RunRoot "sqlite_backup.py"
    $code = @'
import argparse
import json
import os
import sqlite3
from datetime import datetime

TABLES = [
    "portal_users",
    "portal_orders",
    "portal_order_updates",
    "portal_order_media",
    "portal_messages",
    "portal_events",
    "portal_audit_logs",
    "portal_security_logs",
]

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--meta", required=True)
args = parser.parse_args()

src = sqlite3.connect(args.source)
dst = sqlite3.connect(args.output)
try:
    src.backup(dst)
finally:
    dst.close()
    src.close()

con = sqlite3.connect(args.output)
try:
    existing = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    counts = {}
    for table in TABLES:
        if table in existing:
            counts[table] = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        else:
            counts[table] = None
    integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
finally:
    con.close()

meta = {
    "created_at": datetime.now().astimezone().isoformat(),
    "source_db": args.source,
    "output_db": args.output,
    "db_size_bytes": os.path.getsize(args.output),
    "sqlite_integrity_check": integrity,
    "table_counts": counts,
}
with open(args.meta, "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
if integrity != "ok":
    raise SystemExit(f"SQLite integrity_check failed: {integrity}")
'@
    Set-Content -LiteralPath $scriptPath -Value $code -Encoding UTF8
    Invoke-Native -FilePath $py -Arguments @("-B", $scriptPath, "--source", $SourceDb, "--output", $OutputDb, "--meta", $MetaPath) -Name "SQLite backup"
}

function Copy-IfExists([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) {
        Write-Log "Optional item not found, skipping: $Source" "WARN"
        return
    }
    Ensure-Directory (Split-Path -Parent $Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Add-RuntimePayload {
    Write-Log "Creating runtime payload"
    $dbOut = Join-Path $PayloadRoot "backend\data\daiyujin.db"
    $dbMeta = Join-Path $PayloadRoot "db-meta.json"
    Invoke-SqliteBackup -SourceDb $DbPath -OutputDb $dbOut -MetaPath $dbMeta

    foreach ($suffix in @("-wal", "-shm")) {
        $sidecar = "$DbPath$suffix"
        if (Test-Path -LiteralPath $sidecar) {
            Copy-IfExists -Source $sidecar -Destination (Join-Path $PayloadRoot "backend\data\$(Split-Path -Leaf $sidecar)")
        }
    }

    Copy-IfExists -Source (Join-Path $BackendRoot ".env") -Destination (Join-Path $PayloadRoot "backend\.env")
    Copy-IfExists -Source (Join-Path $BackendRoot "private\order_media") -Destination (Join-Path $PayloadRoot "backend\private\order_media")
    Copy-IfExists -Source (Join-Path $BackendRoot "uploads") -Destination (Join-Path $PayloadRoot "backend\uploads")
    Copy-IfExists -Source (Join-Path $BackendRoot "static\thumbnails") -Destination (Join-Path $PayloadRoot "backend\static\thumbnails")
    Copy-IfExists -Source (Join-Path $BackendRoot "static\stl") -Destination (Join-Path $PayloadRoot "backend\static\stl")
}

function Get-DirectoryFileCount([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    return @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force).Count
}

function New-Manifest([string]$PackageName, [hashtable]$PackageHashes) {
    $dbMetaPath = Join-Path $PayloadRoot "db-meta.json"
    $dbMeta = $null
    if (Test-Path -LiteralPath $dbMetaPath) {
        $dbMeta = Get-Content -LiteralPath $dbMetaPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }

    $counts = @{}
    if ($dbMeta -and $dbMeta.table_counts) {
        foreach ($prop in $dbMeta.table_counts.PSObject.Properties) {
            $counts[$prop.Name] = $prop.Value
        }
    }

    $manifest = [ordered]@{
        created_at = (Get-Date).ToString("o")
        mode = $ModeLower
        project_root = $ProjectRoot
        backup_root = $BackupRoot
        db_path = "backend/data/daiyujin.db"
        db_size_bytes = if ($dbMeta) { [int64]$dbMeta.db_size_bytes } else { 0 }
        sqlite_integrity_check = if ($dbMeta) { $dbMeta.sqlite_integrity_check } else { $null }
        portal_user_count = if ($counts.ContainsKey("portal_users")) { $counts["portal_users"] } else { $null }
        portal_order_count = if ($counts.ContainsKey("portal_orders")) { $counts["portal_orders"] } else { $null }
        portal_message_count = if ($counts.ContainsKey("portal_messages")) { $counts["portal_messages"] } else { $null }
        portal_media_count = if ($counts.ContainsKey("portal_order_media")) { $counts["portal_order_media"] } else { $null }
        local_media_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\private\order_media")
        uploads_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\uploads")
        thumbnail_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\static\thumbnails")
        stl_file_count = Get-DirectoryFileCount (Join-Path $PayloadRoot "backend\static\stl")
        r2_media_count = $null
        package = $PackageName
        sha256 = $PackageHashes
    }
    return $manifest
}

function Write-JsonFile($Object, [string]$Path) {
    Ensure-Directory (Split-Path -Parent $Path)
    $Object | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Compress-EncryptedZip([string]$SourceFolder, [string]$ZipPath) {
    if ($DryRun) {
        Write-Log "Dry-run: would create encrypted zip $ZipPath"
        return
    }
    $sevenZip = Resolve-SevenZip
    $password = Get-BackupPassword
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    Ensure-Directory (Split-Path -Parent $ZipPath)
    $sourceGlob = Join-Path $SourceFolder "*"
    Invoke-Native -FilePath $sevenZip -Arguments @("a", "-tzip", $ZipPath, $sourceGlob, "-p$password", "-mem=AES256", "-mx=5", "-y") -Name "7-Zip archive"
}

function Get-LegacyCandidates {
    $now = Get-Date
    $items = New-Object System.Collections.Generic.List[object]

    $rootLocal = Join-Path $ProjectRoot "local_backups"
    if (Test-Path -LiteralPath $rootLocal) {
        Get-ChildItem -LiteralPath $rootLocal -Force | Where-Object { $_.Name -ne "order_portal" } | ForEach-Object {
            if (($now - $_.LastWriteTime).TotalHours -ge 24) {
                $items.Add($_)
            }
        }
    }

    $portalReset = Join-Path $ProjectRoot "_private\backups\portal_reset"
    if (Test-Path -LiteralPath $portalReset) {
        Get-ChildItem -LiteralPath $portalReset -Force | ForEach-Object {
            if (($now - $_.LastWriteTime).TotalHours -ge 24) {
                $items.Add($_)
            }
        }
    }

    if (Test-Path -LiteralPath $DataRoot) {
        $patterns = @("*.backup*", "*.media_r2_backup_*", "*.u8_backup_*", "*.db.*backup*")
        foreach ($pattern in $patterns) {
            Get-ChildItem -LiteralPath $DataRoot -Filter $pattern -Force -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.FullName -ne $DbPath -and ($now - $_.LastWriteTime).TotalHours -ge 24) {
                    $items.Add($_)
                }
            }
        }
    }

    return @($items | Sort-Object FullName -Unique)
}

function Invoke-LegacyCleanup {
    if (-not $CleanLegacyBackups) { return }
    Write-Log "Scanning legacy backup locations"
    $legacyDir = Join-Path $BackupRoot "legacy"
    Ensure-Directory $legacyDir
    $candidates = Get-LegacyCandidates
    $scan = @($candidates | ForEach-Object {
        [ordered]@{
            full_name = $_.FullName
            name = $_.Name
            mode = $_.Mode
            length = if ($_.PSIsContainer) { $null } else { $_.Length }
            last_write_time = $_.LastWriteTime.ToString("o")
        }
    })
    $scanPath = Join-Path $legacyDir "legacy-scan-$Stamp.json"
    Write-JsonFile -Object $scan -Path $scanPath
    Write-Log "Legacy scan written: $scanPath"

    if ($candidates.Count -eq 0) {
        Write-Log "No legacy backups found"
        return
    }

    if ($DryRun) {
        Write-Log "Dry-run: would archive and remove $($candidates.Count) legacy item(s)"
        $candidates | ForEach-Object { Write-Log "Dry-run legacy candidate: $($_.FullName)" }
        return
    }

    $legacyPayload = Join-Path $RunRoot "legacy_payload"
    Ensure-Directory $legacyPayload
    foreach ($item in $candidates) {
        $relative = if ($item.FullName.StartsWith($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Get-RelativePathSafe -Base $ProjectRoot -Path $item.FullName
        } else {
            $item.Name
        }
        $dst = Join-Path $legacyPayload $relative
        Ensure-Directory (Split-Path -Parent $dst)
        Copy-Item -LiteralPath $item.FullName -Destination $dst -Recurse -Force
    }

    $legacyZip = Join-Path $legacyDir "legacy-backups-before-clean-$Stamp.zip"
    Compress-EncryptedZip -SourceFolder $legacyPayload -ZipPath $legacyZip
    $legacyHash = Get-FileSha256 $legacyZip
    Write-JsonFile -Object ([ordered]@{
        created_at = (Get-Date).ToString("o")
        item_count = $candidates.Count
        archive = (Split-Path -Leaf $legacyZip)
        sha256 = @{ (Split-Path -Leaf $legacyZip) = $legacyHash }
        items = $scan
    }) -Path (Join-Path $legacyDir "legacy-clean-$Stamp.manifest.json")

    foreach ($item in $candidates) {
        if ($item.FullName -eq $DbPath) {
            throw "Safety stop: refusing to delete production DB"
        }
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
        Write-Log "Removed legacy item: $($item.FullName)"
    }
}

function Invoke-RetentionCleanup {
    $rules = @{
        daily = $DailyKeep
        weekly = $WeeklyKeep
        monthly = $MonthlyKeep
    }
    foreach ($key in $rules.Keys) {
        $keep = [int]$rules[$key]
        $dir = Join-Path $BackupRoot $key
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $archives = @(Get-ChildItem -LiteralPath $dir -Filter "order-portal-$key-*.zip" -File -Force | Sort-Object LastWriteTime -Descending)
        if ($archives.Count -le $keep) { continue }
        $toRemove = $archives | Select-Object -Skip $keep
        foreach ($archive in $toRemove) {
            $manifest = Join-Path $dir ($archive.BaseName + ".manifest.json")
            if ($DryRun) {
                Write-Log "Dry-run: would remove old backup $($archive.FullName)"
                continue
            }
            Remove-Item -LiteralPath $archive.FullName -Force
            if (Test-Path -LiteralPath $manifest) {
                Remove-Item -LiteralPath $manifest -Force
            }
            Write-Log "Removed old backup: $($archive.FullName)"
        }
    }
}

function Install-BackupTasks {
    $scriptPath = Join-Path $ProjectRoot "Backup-OrderPortal.ps1"
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        throw "Cannot install task because script is not found: $scriptPath"
    }
    $ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $dailyAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode Daily"
    $dailyTrigger = New-ScheduledTaskTrigger -Daily -At 2:30AM
    Register-ScheduledTask -TaskName "Daiyujin Order Portal Daily Backup" -Action $dailyAction -Trigger $dailyTrigger -Description "Create encrypted Order Portal daily backup for Syncthing." -Force | Out-Null
    Write-Log "Installed scheduled task: Daiyujin Order Portal Daily Backup"

    $weeklyAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode Weekly"
    $weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3:00AM
    Register-ScheduledTask -TaskName "Daiyujin Order Portal Weekly Backup" -Action $weeklyAction -Trigger $weeklyTrigger -Description "Create encrypted Order Portal weekly backup for Syncthing." -Force | Out-Null
    Write-Log "Installed scheduled task: Daiyujin Order Portal Weekly Backup"

    $schtasks = "$env:SystemRoot\System32\schtasks.exe"
    if (-not (Test-Path -LiteralPath $schtasks)) {
        throw "Cannot install monthly task because schtasks.exe is not found: $schtasks"
    }
    $monthlyTaskName = "Daiyujin Order Portal Monthly Backup"
    $monthlyCommand = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode Monthly"
    & $schtasks /Create /TN $monthlyTaskName /TR $monthlyCommand /SC MONTHLY /D 1 /ST 03:30 /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install scheduled task: $monthlyTaskName"
    }
    Write-Log "Installed scheduled task: $monthlyTaskName"
}

try {
    Ensure-Directory $BackupRoot
    foreach ($dir in @("daily", "weekly", "monthly", "legacy", "logs", "restore_tests", "pre_restore")) {
        Ensure-Directory (Join-Path $BackupRoot $dir)
    }

    if ($InstallTask) {
        Install-BackupTasks
        return
    }

    Write-Log "Starting Order Portal backup"
    Write-Log "ProjectRoot: $ProjectRoot"
    Write-Log "BackupRoot:  $BackupRoot"
    Write-Log "Mode:        $Mode"

    Invoke-LegacyCleanup

    if ($DryRun) {
        Write-Log "Dry-run: skipping backup package creation"
        Invoke-RetentionCleanup
        return
    }

    Ensure-Directory $PayloadRoot
    Add-RuntimePayload

    $packageDir = Join-Path $BackupRoot $ModeLower
    Ensure-Directory $packageDir
    $packageName = "order-portal-$ModeLower-$Stamp.zip"
    $packagePath = Join-Path $packageDir $packageName

    $internalManifest = New-Manifest -PackageName $packageName -PackageHashes @{}
    Write-JsonFile -Object $internalManifest -Path (Join-Path $PayloadRoot "manifest.json")

    Compress-EncryptedZip -SourceFolder $PayloadRoot -ZipPath $packagePath
    $hashes = @{ $packageName = (Get-FileSha256 $packagePath) }
    $externalManifest = New-Manifest -PackageName $packageName -PackageHashes $hashes
    $manifestPath = Join-Path $packageDir ("order-portal-$ModeLower-$Stamp.manifest.json")
    Write-JsonFile -Object $externalManifest -Path $manifestPath

    Invoke-RetentionCleanup

    Write-Log "Backup created: $packagePath"
    Write-Log "Manifest:       $manifestPath"
    Write-Log "Syncthing folder: $BackupRoot"
}
finally {
    if (Test-Path -LiteralPath $RunRoot) {
        Remove-Item -LiteralPath $RunRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
