param(
    [string]$PythonExe = "D:\anaconda\python.exe",
    [string]$LocalUrl = "http://127.0.0.1:5000/api/health",
    [string]$PublicUrl = "https://api.daiyujin.dpdns.org/api/health",
    [string]$LocationLabel = "company-pc",
    [int]$Samples = 20,
    [string]$OutputDirectory = ".\_private\artifacts\phase4\latency"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$probe = Join-Path $PSScriptRoot "phase4_measure_latency.py"
if (-not (Test-Path -LiteralPath $PythonExe)) {
    throw "Python executable not found: $PythonExe"
}
if (-not (Test-Path -LiteralPath $probe)) {
    throw "Latency probe not found: $probe"
}

$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$runs = @(
    [ordered]@{ name = "local-cold"; url = $LocalUrl; mode = "cold" },
    [ordered]@{ name = "local-reuse"; url = $LocalUrl; mode = "reuse" },
    [ordered]@{ name = "public-cold"; url = $PublicUrl; mode = "cold" },
    [ordered]@{ name = "public-reuse"; url = $PublicUrl; mode = "reuse" }
)

$summaries = @()
foreach ($run in $runs) {
    $outputPath = Join-Path $outputRoot ("{0}-{1}.json" -f $LocationLabel, $run.name)
    & $PythonExe -B $probe `
        --url $run.url `
        --location ("{0}-{1}" -f $LocationLabel, $run.name) `
        --samples $Samples `
        --connection-mode $run.mode `
        --output $outputPath
    if ($LASTEXITCODE -ne 0) {
        throw "Latency probe failed: $($run.name)"
    }
    $report = Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json
    $summaries += [ordered]@{
        name = $run.name
        success_rate = $report.success_rate
        total_p50_ms = $report.metrics_ms.total.p50
        total_p95_ms = $report.metrics_ms.total.p95
        response_headers_p95_ms = $report.metrics_ms.response_headers.p95
        connection_reused_count = $report.connection_reused_count
    }
}

$summaryPath = Join-Path $outputRoot ("{0}-comparison.json" -f $LocationLabel)
$summary = [ordered]@{
    schema_version = 1
    generated_at_utc = [DateTime]::UtcNow.ToString("o")
    location = $LocationLabel
    samples_per_run = $Samples
    runs = $summaries
}
$summaryJson = $summary | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText(
    $summaryPath,
    $summaryJson + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)

Write-Host "Local/public latency comparison written: $summaryPath"
$summaries | Format-Table -AutoSize
