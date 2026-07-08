<#
Read-only diagnostics for Order Portal backup/sync/startup operations.

This script does not create backups, delete files, restore files, edit tasks, or
write anything outside local_backups\order_portal\logs unless -OutputPath is set.

Usage on company PC:
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\daiyujin\daiyujinweb\Diagnose-OrderPortalOps.ps1
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$BackupRoot = "",
    [string]$OutputPath = "",
    [int]$RecentBackupHours = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Resolve-DefaultProjectRoot {
    if ($ProjectRoot) {
        if (-not (Test-Path -LiteralPath $ProjectRoot)) {
            throw "ProjectRoot not found: $ProjectRoot"
        }
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
if (-not $OutputPath) {
    $OutputPath = Join-Path (Join-Path $BackupRoot "logs") "ops-diagnosis-$Stamp.txt"
}

$Script:Lines = New-Object System.Collections.Generic.List[string]
$Script:Warnings = New-Object System.Collections.Generic.List[string]

function Add-Line([string]$Text = "") {
    $Script:Lines.Add($Text) | Out-Null
}

function Add-Warn([string]$Text) {
    $Script:Warnings.Add($Text) | Out-Null
    Add-Line "WARN: $Text"
}

function Add-Section([string]$Title) {
    Add-Line ""
    Add-Line "## $Title"
}

function Format-Bytes([Nullable[long]]$Bytes) {
    if ($null -eq $Bytes) { return "-" }
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Get-DirectoryStats([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{ Exists = $false; FileCount = 0; TotalBytes = 0L }
    }
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue)
    $total = 0L
    foreach ($file in $files) {
        $total += [int64]$file.Length
    }
    return [pscustomobject]@{ Exists = $true; FileCount = $files.Count; TotalBytes = $total }
}

function Get-EnvFlag([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name, "Process")
    $scope = "Process"
    if (-not $value) {
        $value = [Environment]::GetEnvironmentVariable($Name, "User")
        $scope = "User"
    }
    if (-not $value) {
        $value = [Environment]::GetEnvironmentVariable($Name, "Machine")
        $scope = "Machine"
    }
    if ($value) {
        return "$scope set, length=$($value.Length)"
    }
    return "not set"
}

function Read-EnvKeys([string]$EnvPath) {
    if (-not (Test-Path -LiteralPath $EnvPath)) {
        return @()
    }
    $keys = New-Object System.Collections.Generic.List[string]
    Get-Content -LiteralPath $EnvPath -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $keys.Add($line.Split("=", 2)[0].Trim()) | Out-Null
        }
    }
    return @($keys | Sort-Object -Unique)
}

function Get-LatestBackupRows([string]$Folder, [string]$Mode) {
    if (-not (Test-Path -LiteralPath $Folder)) { return @() }
    return @(Get-ChildItem -LiteralPath $Folder -Filter "order-portal-$Mode-*.zip" -File -Force -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 5)
}

function Add-BackupModeReport([string]$Mode) {
    $folder = Join-Path $BackupRoot $Mode
    Add-Line "[$Mode] $folder"
    if (-not (Test-Path -LiteralPath $folder)) {
        Add-Warn "$Mode backup folder missing: $folder"
        return
    }
    $rows = @(Get-LatestBackupRows -Folder $folder -Mode $Mode)
    if ($rows.Count -eq 0) {
        Add-Warn "No $Mode backup zip found."
        return
    }
    foreach ($row in $rows) {
        $ageHours = [math]::Round(((Get-Date) - $row.LastWriteTime).TotalHours, 1)
        $manifest = Join-Path $folder ($row.BaseName + ".manifest.json")
        $manifestStatus = if (Test-Path -LiteralPath $manifest) { "manifest=yes" } else { "manifest=missing" }
        Add-Line ("  {0} | {1} | age={2}h | {3}" -f $row.Name, (Format-Bytes $row.Length), $ageHours, $manifestStatus)
        if (-not (Test-Path -LiteralPath $manifest)) {
            Add-Warn "Backup manifest missing for $($row.FullName)"
        }
    }
    $latest = $rows[0]
    if ($Mode -eq "daily" -and ((Get-Date) - $latest.LastWriteTime).TotalHours -gt $RecentBackupHours) {
        Add-Warn "Latest daily backup is older than $RecentBackupHours hours."
    }
}

function Add-ManifestSummary {
    $dailyFolder = Join-Path $BackupRoot "daily"
    $latest = Get-LatestBackupRows -Folder $dailyFolder -Mode "daily" | Select-Object -First 1
    if (-not $latest) { return }
    $manifestPath = Join-Path $dailyFolder ($latest.BaseName + ".manifest.json")
    if (-not (Test-Path -LiteralPath $manifestPath)) { return }
    try {
        $m = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Add-Line "Latest daily manifest: $manifestPath"
        Add-Line "  created_at: $($m.created_at)"
        Add-Line "  db_size:    $(Format-Bytes ([int64]$m.db_size_bytes))"
        Add-Line "  users:      $($m.portal_user_count)"
        Add-Line "  orders:     $($m.portal_order_count)"
        Add-Line "  messages:   $($m.portal_message_count)"
        Add-Line "  media rows: $($m.portal_media_count)"
        Add-Line "  local media files: $($m.local_media_file_count)"
    }
    catch {
        Add-Warn "Failed to parse latest daily manifest: $($_.Exception.Message)"
    }
}

function Get-ObjectPropertyText($Object, [string]$Name) {
    if ($null -eq $Object) { return "" }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop -and $null -ne $prop.Value) {
        return [string]$prop.Value
    }
    return ""
}

function Get-TaskActionText($Action) {
    $execute = Get-ObjectPropertyText $Action "Execute"
    $arguments = Get-ObjectPropertyText $Action "Arguments"
    $workingDirectory = Get-ObjectPropertyText $Action "WorkingDirectory"
    $text = ("$execute $arguments $workingDirectory").Trim()
    if ($text) { return $text }

    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($prop in $Action.PSObject.Properties) {
        if ($prop.Name -match "Execute|Argument|Path|Command|WorkingDirectory|Program" -and $null -ne $prop.Value) {
            $parts.Add("$($prop.Name)=$($prop.Value)") | Out-Null
        }
    }
    if ($parts.Count -gt 0) {
        return ($parts -join " ")
    }
    return [string]$Action
}

function Add-TaskReport {
    Add-Section "Scheduled Tasks"
    $taskNames = @(
        "Daiyujin Order Portal Daily Backup",
        "Daiyujin Order Portal Weekly Backup"
    )
    foreach ($name in $taskNames) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) {
            Add-Warn "Scheduled task missing: $name"
            continue
        }
        Add-Line "$name | State=$($task.State)"
        foreach ($trigger in $task.Triggers) {
            Add-Line "  Trigger: $($trigger.ToString())"
        }
        foreach ($action in $task.Actions) {
            $actionText = Get-TaskActionText $action
            Add-Line "  Action: $actionText"
            if ($actionText -notmatch "ExecutionPolicy\s+Bypass") {
                Add-Warn "$name action does not include ExecutionPolicy Bypass."
            }
        }
        $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue
        if ($info) {
            Add-Line "  LastRunTime=$($info.LastRunTime) LastTaskResult=$($info.LastTaskResult) NextRunTime=$($info.NextRunTime)"
        }
    }

    Add-Line ""
    Add-Line "Related scheduled tasks containing daiyujin/cloudflared/syncthing:"
    $related = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
        $_.TaskName -match "daiyujin|cloudflared|syncthing|portal|backup" -or
        ($_.Actions | Where-Object { (Get-TaskActionText $_) -match "daiyujin|cloudflared|syncthing|portal|backup" })
    } | Sort-Object TaskName)
    if ($related.Count -eq 0) {
        Add-Line "  none"
    } else {
        foreach ($task in $related) {
            Add-Line "  $($task.TaskName) | State=$($task.State)"
        }
    }
}

function Add-ServiceAndProcessReport {
    Add-Section "Services and Processes"
    foreach ($svcName in @("Cloudflared", "cloudflared", "Syncthing", "syncthing")) {
        $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
        if ($svc) {
            Add-Line "Service $($svc.Name): Status=$($svc.Status) StartType=$($svc.StartType)"
        }
    }
    $cloudflared = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
    $syncthing = Get-Process -Name "syncthing" -ErrorAction SilentlyContinue
    $pythonLike = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "python|waitress" })
    Add-Line "cloudflared process count: $(@($cloudflared).Count)"
    Add-Line "syncthing process count:   $(@($syncthing).Count)"
    Add-Line "python/waitress process count: $($pythonLike.Count)"
    if (-not $cloudflared) { Add-Warn "cloudflared process not found." }
    if (-not $syncthing) { Add-Warn "syncthing process not found." }
}

function Add-PortReport {
    Add-Section "Local Ports"
    foreach ($port in @(5000, 5010, 8384)) {
        $rows = @(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue)
        if ($rows.Count -eq 0) {
            Add-Line "Port ${port}: not listening"
            if ($port -eq 5000) { Add-Warn "API port 5000 is not listening." }
            continue
        }
        foreach ($row in $rows) {
            Add-Line "Port ${port}: State=$($row.State) OwningProcess=$($row.OwningProcess)"
        }
    }
}

function Add-StartupReport {
    Add-Section "Startup Entries"
    $startupFolders = @(
        [Environment]::GetFolderPath("Startup"),
        "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    foreach ($folder in $startupFolders) {
        Add-Line "Startup folder: $folder"
        Get-ChildItem -LiteralPath $folder -Force -ErrorAction SilentlyContinue | ForEach-Object {
            Add-Line "  $($_.Name)"
        }
    }

    $runKeys = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run"
    )
    foreach ($key in $runKeys) {
        if (-not (Test-Path $key)) { continue }
        Add-Line "Run key: $key"
        $props = Get-ItemProperty -Path $key
        $props.PSObject.Properties | Where-Object {
            $_.Name -notmatch "^PS" -and ($_.Value -match "daiyujin|cloudflared|syncthing|start-api|tunnel|backup")
        } | ForEach-Object {
            Add-Line "  $($_.Name) = $($_.Value)"
        }
    }
}

function Add-PathReport {
    Add-Section "Important Paths"
    $paths = @(
        $ProjectRoot,
        $BackendRoot,
        $DbPath,
        (Join-Path $BackendRoot ".env"),
        (Join-Path $BackendRoot "private\order_media"),
        (Join-Path $BackendRoot "uploads"),
        (Join-Path $BackendRoot "static\thumbnails"),
        (Join-Path $BackendRoot "static\stl"),
        $BackupRoot,
        (Join-Path $ProjectRoot "local_backups"),
        (Join-Path $ProjectRoot "_private\backups\portal_reset")
    )
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force
            if ($item.PSIsContainer) {
                $stats = Get-DirectoryStats $path
                Add-Line "$path | dir | files=$($stats.FileCount) | size=$(Format-Bytes $stats.TotalBytes) | modified=$($item.LastWriteTime)"
            } else {
                Add-Line "$path | file | size=$(Format-Bytes $item.Length) | modified=$($item.LastWriteTime)"
            }
        } else {
            Add-Line "$path | missing"
        }
    }
}

function Add-LegacyBackupReport {
    Add-Section "Legacy / Scattered Backups"
    $candidates = New-Object System.Collections.Generic.List[object]
    $rootLocal = Join-Path $ProjectRoot "local_backups"
    if (Test-Path -LiteralPath $rootLocal) {
        Get-ChildItem -LiteralPath $rootLocal -Force | Where-Object { $_.Name -ne "order_portal" } | ForEach-Object { $candidates.Add($_) | Out-Null }
    }
    $portalReset = Join-Path $ProjectRoot "_private\backups\portal_reset"
    if (Test-Path -LiteralPath $portalReset) {
        Get-ChildItem -LiteralPath $portalReset -Force | ForEach-Object { $candidates.Add($_) | Out-Null }
    }
    if (Test-Path -LiteralPath $DataRoot) {
        foreach ($pattern in @("*.backup*", "*.media_r2_backup_*", "*.u8_backup_*", "*.db.*backup*")) {
            Get-ChildItem -LiteralPath $DataRoot -Filter $pattern -Force -ErrorAction SilentlyContinue | ForEach-Object { $candidates.Add($_) | Out-Null }
        }
    }
    $items = @($candidates | Sort-Object FullName -Unique)
    if ($items.Count -eq 0) {
        Add-Line "No scattered legacy backup candidates found."
        return
    }
    foreach ($item in $items) {
        $size = if ($item.PSIsContainer) { (Format-Bytes (Get-DirectoryStats $item.FullName).TotalBytes) } else { Format-Bytes $item.Length }
        Add-Line "  $($item.FullName) | $size | modified=$($item.LastWriteTime)"
    }
    Add-Warn "Scattered legacy backups exist. Use Backup-OrderPortal.ps1 -CleanLegacyBackups -DryRun before cleanup."
}

function Add-BackupReport {
    Add-Section "Order Portal Backups"
    foreach ($mode in @("daily", "weekly", "monthly")) {
        Add-BackupModeReport -Mode $mode
    }
    Add-ManifestSummary
}

function Add-ScriptReport {
    Add-Section "Backup / Update Scripts"
    foreach ($name in @("Backup-OrderPortal.ps1", "Restore-OrderPortal.ps1", "Update-Company-PC.ps1", "start-api.bat", "start-tunnel.bat")) {
        $path = Join-Path $ProjectRoot $name
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path
            Add-Line "$name | size=$(Format-Bytes $item.Length) | modified=$($item.LastWriteTime)"
        } else {
            Add-Warn "Missing script: $name"
        }
    }
    $updateScript = Join-Path $ProjectRoot "Update-Company-PC.ps1"
    if (Test-Path -LiteralPath $updateScript) {
        $content = Get-Content -LiteralPath $updateScript -Raw -Encoding UTF8
        if ($content -match 'Join-Path \$ProjectRoot "local_backups"') {
            Add-Warn "Update-Company-PC.ps1 still writes update backups to root local_backups, separate from order_portal backup root."
        }
    }
}

function Add-GitReport {
    Add-Section "Git State"
    try {
        Push-Location $ProjectRoot
        $branch = git branch --show-current 2>$null
        $head = git log -1 --oneline 2>$null
        $status = git status --short 2>$null
        Add-Line "Branch: $branch"
        Add-Line "HEAD:   $head"
        if ($status) {
            Add-Line "Working tree:"
            $status | ForEach-Object { Add-Line "  $_" }
        } else {
            Add-Line "Working tree: clean"
        }
    }
    catch {
        Add-Warn "Git inspection failed: $($_.Exception.Message)"
    }
    finally {
        Pop-Location
    }
}

function Add-EnvironmentReport {
    Add-Section "Environment"
    Add-Line "Time:          $((Get-Date).ToString('o'))"
    Add-Line "ComputerName:  $env:COMPUTERNAME"
    Add-Line "UserName:      $env:USERNAME"
    Add-Line "PowerShell:    $($PSVersionTable.PSVersion)"
    Add-Line "ProjectRoot:   $ProjectRoot"
    Add-Line "BackupRoot:    $BackupRoot"
    Add-Line "Backup password env: $(Get-EnvFlag 'ORDER_PORTAL_BACKUP_PASSWORD')"
    $envPath = Join-Path $BackendRoot ".env"
    Add-Line "backend\.env exists: $(Test-Path -LiteralPath $envPath)"
    $keys = @(Read-EnvKeys $envPath)
    if ($keys.Count -gt 0) {
        Add-Line "backend\.env keys: $($keys -join ', ')"
    }
    if ((Get-EnvFlag "ORDER_PORTAL_BACKUP_PASSWORD") -eq "not set") {
        Add-Warn "ORDER_PORTAL_BACKUP_PASSWORD is not set. Scheduled encrypted backups may fail unless set at User or Machine scope."
    }
}

function Add-Summary {
    Add-Section "Summary / Warnings"
    if ($Script:Warnings.Count -eq 0) {
        Add-Line "No warnings detected."
    } else {
        foreach ($warning in $Script:Warnings) {
            Add-Line "- $warning"
        }
    }
}

try {
    Add-Line "# Order Portal Operations Diagnosis"
    Add-EnvironmentReport
    Add-GitReport
    Add-PathReport
    Add-BackupReport
    Add-LegacyBackupReport
    Add-TaskReport
    Add-ServiceAndProcessReport
    Add-PortReport
    Add-StartupReport
    Add-ScriptReport
    Add-Summary

    $outDir = Split-Path -Parent $OutputPath
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }
    $text = $Script:Lines -join [Environment]::NewLine
    Set-Content -LiteralPath $OutputPath -Value $text -Encoding UTF8
    Write-Host $text
    Write-Host ""
    Write-Host "Diagnosis report written to:"
    Write-Host $OutputPath
}
catch {
    Write-Error $_.Exception.Message
    throw
}
