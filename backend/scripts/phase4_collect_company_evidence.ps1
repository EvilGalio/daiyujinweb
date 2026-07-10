param(
    [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")),
    [string]$PythonExe = "",
    [string]$LocalUrl = "http://127.0.0.1:5000/api/health",
    [string]$PublicUrl = "https://api.daiyujin.dpdns.org/api/health",
    [string]$LocationLabel = "company-pc",
    [ValidateSet("idle", "representative-load")]
    [string]$WorkloadLabel = "idle",
    [int]$Samples = 20,
    [ValidateRange(5, 300)]
    [int]$ResourceSampleSeconds = 30,
    [switch]$SkipLatency
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-PythonExecutable {
    param([string]$RequestedPath, [string]$Root)
    if ($RequestedPath) {
        if (-not (Test-Path -LiteralPath $RequestedPath)) {
            throw "Python executable not found: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $backendEnv = Join-Path $Root "backend\.env"
    if (Test-Path -LiteralPath $backendEnv) {
        $match = Select-String -LiteralPath $backendEnv -Pattern "^OCC_PYTHON=" | Select-Object -First 1
        if ($null -ne $match) {
            $candidate = $match.Line.Split("=", 2)[1].Trim().Trim('"').Trim("'")
            if (Test-Path -LiteralPath $candidate) {
                return (Resolve-Path -LiteralPath $candidate).Path
            }
        }
    }

    $candidates = @(
        "D:\anaconda\python.exe",
        "C:\Users\62536\miniconda3\envs\occ\python.exe",
        "C:\Users\14539\miniconda3\envs\occ\python.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "No approved Python executable was found. Pass -PythonExe explicitly."
}

function Invoke-EvidenceStep {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    $started = Get-Date
    try {
        $null = & $Action
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "$Name exited with code $exitCode"
        }
        return [pscustomobject][ordered]@{
            name = $Name
            status = "pass"
            duration_ms = [int](((Get-Date) - $started).TotalMilliseconds)
            error_type = $null
        }
    }
    catch {
        return [pscustomobject][ordered]@{
            name = $Name
            status = "fail"
            duration_ms = [int](((Get-Date) - $started).TotalMilliseconds)
            error_type = $_.Exception.GetType().Name
        }
    }
}

$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$python = Resolve-PythonExecutable -RequestedPath $PythonExe -Root $root
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputRoot = Join-Path $root "_private\artifacts\phase4\company-pc\$WorkloadLabel\$timestamp"
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$systemInventory = Join-Path $outputRoot "system-inventory.json"
$legacyInventory = Join-Path $outputRoot "legacy-sqlite-inventory.json"
$storageInventory = Join-Path $outputRoot "runtime-storage-inventory.json"
$r2Inventory = Join-Path $outputRoot "r2-object-inventory.json"
$database = Join-Path $root "backend\data\daiyujin.db"
$steps = @()

$steps += Invoke-EvidenceStep -Name "system_inventory" -Action {
    powershell.exe -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $root "backend\scripts\phase4_system_inventory.ps1") `
        -OutputPath $systemInventory `
        -WorkloadLabel $WorkloadLabel `
        -SampleSeconds $ResourceSampleSeconds
}
$steps += Invoke-EvidenceStep -Name "resource_window_validation" -Action {
    if (-not (Test-Path -LiteralPath $systemInventory -PathType Leaf)) {
        throw "System inventory was not written"
    }
    $inventory = Get-Content -LiteralPath $systemInventory -Raw | ConvertFrom-Json
    if ($inventory.resource_window.sample_count -lt 1) {
        throw "Resource window contains no samples"
    }
    if ($null -eq $inventory.resource_window.summary.cpu_percent.p95) {
        throw "CPU performance data is unavailable"
    }
    if ($null -eq $inventory.resource_window.summary.available_memory_bytes.p50) {
        throw "Memory performance data is unavailable"
    }
    if ($null -eq $inventory.resource_window.summary.disk_queue_length.p95) {
        throw "Disk queue performance data is unavailable"
    }
}
$steps += Invoke-EvidenceStep -Name "legacy_inventory" -Action {
    & $python -B (Join-Path $root "backend\scripts\phase4_inventory_legacy.py") `
        --database $database `
        --output $legacyInventory
}
$steps += Invoke-EvidenceStep -Name "runtime_storage_inventory" -Action {
    & $python -B (Join-Path $root "backend\scripts\phase4_inventory_runtime_storage.py") `
        --database $database `
        --output $storageInventory `
        --content-hashes
}
$steps += Invoke-EvidenceStep -Name "r2_object_inventory" -Action {
    & $python -B (Join-Path $root "backend\scripts\phase4_inventory_r2.py") `
        --database $database `
        --env-file (Join-Path $root "backend\.env") `
        --output $r2Inventory
}
if (-not $SkipLatency) {
    $relativeLatencyOutput = `
        "_private\artifacts\phase4\company-pc\$WorkloadLabel\$timestamp\latency"
    $steps += Invoke-EvidenceStep -Name "local_public_latency" -Action {
        powershell.exe -NoProfile -ExecutionPolicy Bypass `
            -File (Join-Path $root "backend\scripts\phase4_compare_local_public.ps1") `
            -PythonExe $python `
            -LocalUrl $LocalUrl `
            -PublicUrl $PublicUrl `
            -LocationLabel ("{0}-{1}" -f $LocationLabel, $WorkloadLabel) `
            -Samples $Samples `
            -OutputDirectory $relativeLatencyOutput
    }
}

$evidenceFiles = @(Get-ChildItem -LiteralPath $outputRoot -Recurse -File | ForEach-Object {
    [ordered]@{
        relative_path = $_.FullName.Substring($outputRoot.Length).TrimStart("\")
        size_bytes = [int64]$_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$manifest = [ordered]@{
    schema_version = 1
    generated_at_utc = [DateTime]::UtcNow.ToString("o")
    location_label = $LocationLabel
    workload_label = $WorkloadLabel
    resource_sample_seconds = $ResourceSampleSeconds
    python_executable_filename = Split-Path -Leaf $python
    latency_skipped = [bool]$SkipLatency
    steps = $steps
    evidence_files = $evidenceFiles
}
$manifestPath = Join-Path $outputRoot "manifest.json"
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

$failed = @($steps | Where-Object { $_.status -eq "fail" })
Write-Host "Phase 4 company evidence: $outputRoot"
$steps | Format-Table name, status, duration_ms, error_type -AutoSize
if ($failed.Count -gt 0) {
    Write-Error "$($failed.Count) evidence step(s) failed. Inspect the generated manifest."
    exit 1
}
Write-Host "Phase 4 company evidence collection: PASS"
