[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$")]
    [string]$RegionLabel,
    [string]$PythonExe = "",
    [string]$PublicUrl = "https://api.daiyujin.dpdns.org/api/health",
    [ValidateRange(10, 200)]
    [int]$Samples = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ProbePython {
    param([string]$RequestedPath)
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
            throw "Python executable not found: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }
    foreach ($candidate in @(
        "D:\anaconda\python.exe",
        "C:\ProgramData\miniconda3\python.exe",
        "C:\Program Files\Python312\python.exe"
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "No approved Python executable found. Pass -PythonExe explicitly."
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$python = Resolve-ProbePython -RequestedPath $PythonExe
$probe = Join-Path $root "backend\scripts\phase4_measure_latency.py"
if (-not (Test-Path -LiteralPath $probe -PathType Leaf)) {
    throw "Latency probe not found: $probe"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputRoot = Join-Path $root "_private\artifacts\phase4\latency\$RegionLabel\$timestamp"
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$reports = @()
foreach ($mode in @("cold", "reuse")) {
    $output = Join-Path $outputRoot ("{0}-{1}.json" -f $RegionLabel, $mode)
    & $python -B $probe `
        --url $PublicUrl `
        --location ("{0}-{1}" -f $RegionLabel, $mode) `
        --samples $Samples `
        --connection-mode $mode `
        --output $output
    if ($LASTEXITCODE -ne 0) {
        throw "Regional latency probe failed: $mode"
    }
    $payload = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
    $reports += [ordered]@{
        mode = $mode
        relative_path = Split-Path -Leaf $output
        sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
        success_rate = $payload.success_rate
        total_p50_ms = $payload.metrics_ms.total.p50
        total_p95_ms = $payload.metrics_ms.total.p95
        response_headers_p95_ms = $payload.metrics_ms.response_headers.p95
    }
}

$manifestPath = Join-Path $outputRoot "manifest.json"
$manifest = [ordered]@{
    schema_version = 1
    generated_at_utc = [DateTime]::UtcNow.ToString("o")
    region_label = $RegionLabel
    public_url = $PublicUrl
    samples_per_mode = $Samples
    reports = $reports
    result = if (@($reports | Where-Object { $_.success_rate -lt 1.0 }).Count -eq 0) {
        "pass"
    }
    else {
        "fail"
    }
}
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText(
    $manifestPath,
    $json + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)

Write-Host "Regional latency evidence: $outputRoot"
$reports | Format-Table mode, success_rate, total_p50_ms, total_p95_ms -AutoSize
if ($manifest.result -ne "pass") {
    throw "One or more regional latency samples failed."
}
Write-Host "Phase 4 regional latency collection: PASS"
