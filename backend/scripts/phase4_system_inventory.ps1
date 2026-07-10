param(
    [string]$OutputPath = ".\_private\artifacts\phase4\inventory\system-inventory.json",
    [ValidateSet("idle", "representative-load", "diagnostic")]
    [string]$WorkloadLabel = "diagnostic",
    [ValidateRange(1, 300)]
    [int]$SampleSeconds = 15,
    [ValidateRange(1, 30)]
    [int]$SampleIntervalSeconds = 1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ServiceSummary {
    $patterns = @("Cloudflared", "postgresql*", "valkey*", "redis*")
    $items = @()
    foreach ($pattern in $patterns) {
        $items += Get-Service -Name $pattern -ErrorAction SilentlyContinue | ForEach-Object {
            [ordered]@{
                name = $_.Name
                status = $_.Status.ToString()
                start_type = $_.StartType.ToString()
            }
        }
    }
    return @($items | Sort-Object name -Unique)
}

function Get-PortSummary {
    $ports = @(5000, 5010, 5100, 5200, 5300, 5432, 6379, 7844, 15432)
    $dotNetListeners = @(
        [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    )
    $items = @()
    foreach ($port in $ports) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        $fallbackListeners = @($dotNetListeners | Where-Object { $_.Port -eq $port })
        $processNames = @()
        foreach ($listener in $listeners) {
            $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
            if ($null -ne $process) {
                $processNames += $process.ProcessName
            }
        }
        $items += [ordered]@{
            port = $port
            listening = ($listeners.Count -gt 0) -or ($fallbackListeners.Count -gt 0)
            listener_count = [Math]::Max($listeners.Count, $fallbackListeners.Count)
            process_names = @($processNames | Sort-Object -Unique)
        }
    }
    return $items
}

function Get-MetricSummary {
    param([object[]]$Values)
    $numbers = @($Values | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ } | Sort-Object)
    if ($numbers.Count -eq 0) {
        return [ordered]@{ min = $null; p50 = $null; p95 = $null; max = $null; average = $null }
    }
    $p50Index = [Math]::Max(0, [Math]::Ceiling(0.50 * $numbers.Count) - 1)
    $p95Index = [Math]::Max(0, [Math]::Ceiling(0.95 * $numbers.Count) - 1)
    return [ordered]@{
        min = [Math]::Round($numbers[0], 3)
        p50 = [Math]::Round($numbers[$p50Index], 3)
        p95 = [Math]::Round($numbers[$p95Index], 3)
        max = [Math]::Round($numbers[-1], 3)
        average = [Math]::Round(($numbers | Measure-Object -Average).Average, 3)
    }
}

function Get-ResourceSample {
    param([int64]$FallbackAvailableMemoryBytes)
    $cpuPercent = $null
    $availableMemoryBytes = $null
    $diskQueueLength = $null
    $diskReadLatencyMs = $null
    $diskWriteLatencyMs = $null
    $diskBusyPercent = $null

    try {
        $cpu = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor `
            -Filter "Name='_Total'" -ErrorAction Stop
        $cpuPercent = [double]$cpu.PercentProcessorTime
    }
    catch {
        try {
            $cpuPercent = [double](
                Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop |
                    Measure-Object -Property LoadPercentage -Average
            ).Average
        }
        catch {
            $cpuPercent = $null
        }
    }

    try {
        $memorySample = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory `
            -ErrorAction Stop
        $availableMemoryBytes = [int64]$memorySample.AvailableBytes
    }
    catch {
        $availableMemoryBytes = $FallbackAvailableMemoryBytes
    }

    try {
        $disk = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_LogicalDisk `
            -Filter "Name='_Total'" -ErrorAction Stop
        $diskQueueLength = [double]$disk.CurrentDiskQueueLength
        $diskReadLatencyMs = [double]$disk.AvgDisksecPerRead * 1000
        $diskWriteLatencyMs = [double]$disk.AvgDisksecPerWrite * 1000
        $diskBusyPercent = [double]$disk.PercentDiskTime
    }
    catch {
        $diskQueueLength = $null
    }

    return [ordered]@{
        captured_at_utc = [DateTime]::UtcNow.ToString("o")
        cpu_percent = $cpuPercent
        available_memory_bytes = $availableMemoryBytes
        disk_queue_length = $diskQueueLength
        disk_read_latency_ms = $diskReadLatencyMs
        disk_write_latency_ms = $diskWriteLatencyMs
        disk_busy_percent = $diskBusyPercent
    }
}

$collectionWarnings = @()
$computer = $null
$os = $null
$processors = @()
$disks = @()
try {
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $processors = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
    $disks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop)
}
catch {
    $collectionWarnings += "cim_unavailable_fallback_used"
}

Add-Type -AssemblyName Microsoft.VisualBasic
$memory = New-Object Microsoft.VisualBasic.Devices.ComputerInfo
$windowsInfo = Get-ItemProperty `
    -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" `
    -ErrorAction SilentlyContinue
$cpuInfo = Get-ItemProperty `
    -LiteralPath "HKLM:\HARDWARE\DESCRIPTION\System\CentralProcessor\0" `
    -ErrorAction SilentlyContinue

$sampleCount = [Math]::Max(1, [Math]::Ceiling($SampleSeconds / $SampleIntervalSeconds))
$resourceStartedAt = [DateTime]::UtcNow
$resourceSamples = @()
for ($index = 0; $index -lt $sampleCount; $index++) {
    $resourceSamples += Get-ResourceSample `
        -FallbackAvailableMemoryBytes ([int64]$memory.AvailablePhysicalMemory)
    if ($index + 1 -lt $sampleCount) {
        Start-Sleep -Seconds $SampleIntervalSeconds
    }
}
$resourceCompletedAt = [DateTime]::UtcNow
$resourceSummary = [ordered]@{
    cpu_percent = Get-MetricSummary @($resourceSamples | ForEach-Object { $_.cpu_percent })
    available_memory_bytes = Get-MetricSummary @(
        $resourceSamples | ForEach-Object { $_.available_memory_bytes }
    )
    disk_queue_length = Get-MetricSummary @(
        $resourceSamples | ForEach-Object { $_.disk_queue_length }
    )
    disk_read_latency_ms = Get-MetricSummary @(
        $resourceSamples | ForEach-Object { $_.disk_read_latency_ms }
    )
    disk_write_latency_ms = Get-MetricSummary @(
        $resourceSamples | ForEach-Object { $_.disk_write_latency_ms }
    )
    disk_busy_percent = Get-MetricSummary @(
        $resourceSamples | ForEach-Object { $_.disk_busy_percent }
    )
}

if ($null -eq $computer) {
    $computerPayload = [ordered]@{
        manufacturer = $env:COMPUTERNAME
        model = "unavailable_without_cim"
        logical_processors = [Environment]::ProcessorCount
        total_memory_bytes = [int64]$memory.TotalPhysicalMemory
    }
}
else {
    $computerPayload = [ordered]@{
        manufacturer = $computer.Manufacturer
        model = $computer.Model
        logical_processors = [int]$computer.NumberOfLogicalProcessors
        total_memory_bytes = [int64]$computer.TotalPhysicalMemory
    }
}

if ($null -eq $os) {
    $operatingSystemPayload = [ordered]@{
        caption = if ($null -ne $windowsInfo) { $windowsInfo.ProductName } else { [Environment]::OSVersion.VersionString }
        version = if ($null -ne $windowsInfo) { $windowsInfo.DisplayVersion } else { [Environment]::OSVersion.Version.ToString() }
        build_number = if ($null -ne $windowsInfo) { $windowsInfo.CurrentBuildNumber } else { [Environment]::OSVersion.Version.Build }
        last_boot_time = $null
        free_physical_memory_kb = [int64]($memory.AvailablePhysicalMemory / 1KB)
    }
}
else {
    $operatingSystemPayload = [ordered]@{
        caption = $os.Caption
        version = $os.Version
        build_number = $os.BuildNumber
        last_boot_time = $os.LastBootUpTime.ToString("o")
        free_physical_memory_kb = [int64]$os.FreePhysicalMemory
    }
}

if ($processors.Count -eq 0) {
    $processorPayload = @(
        [ordered]@{
            name = if ($null -ne $cpuInfo) { $cpuInfo.ProcessorNameString } else { "unavailable_without_cim" }
            cores = $null
            logical_processors = [Environment]::ProcessorCount
            load_percentage = $null
        }
    )
}
else {
    $processorPayload = @($processors | ForEach-Object {
        [ordered]@{
            name = $_.Name
            cores = [int]$_.NumberOfCores
            logical_processors = [int]$_.NumberOfLogicalProcessors
            load_percentage = [int]$_.LoadPercentage
        }
    })
}

if ($disks.Count -eq 0) {
    $diskPayload = @([IO.DriveInfo]::GetDrives() | Where-Object {
        $_.IsReady -and $_.DriveType -eq [IO.DriveType]::Fixed
    } | ForEach-Object {
        [ordered]@{
            drive = $_.Name.TrimEnd("\")
            file_system = $_.DriveFormat
            size_bytes = [int64]$_.TotalSize
            free_bytes = [int64]$_.AvailableFreeSpace
        }
    })
}
else {
    $diskPayload = @($disks | ForEach-Object {
        [ordered]@{
            drive = $_.DeviceID
            file_system = $_.FileSystem
            size_bytes = [int64]$_.Size
            free_bytes = [int64]$_.FreeSpace
        }
    })
}

$payload = [ordered]@{
    schema_version = 1
    generated_at_utc = [DateTime]::UtcNow.ToString("o")
    local_time = (Get-Date).ToString("o")
    collection_warnings = @($collectionWarnings)
    computer = $computerPayload
    operating_system = $operatingSystemPayload
    processors = $processorPayload
    disks = $diskPayload
    services = @(Get-ServiceSummary)
    ports = @(Get-PortSummary)
    resource_window = [ordered]@{
        workload_label = $WorkloadLabel
        started_at_utc = $resourceStartedAt.ToString("o")
        completed_at_utc = $resourceCompletedAt.ToString("o")
        requested_seconds = $SampleSeconds
        sample_interval_seconds = $SampleIntervalSeconds
        sample_count = $resourceSamples.Count
        summary = $resourceSummary
        samples = @($resourceSamples)
    }
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$parent = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
}
$json = $payload | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($resolvedOutput, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Host "System inventory written: $resolvedOutput"
