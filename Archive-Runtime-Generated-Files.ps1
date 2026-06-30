<#
Archive generated runtime files without changing backend paths.

Usage:
  .\Archive-Runtime-Generated-Files.ps1

It moves current generated files from:
- backend/uploads
- backend/static/thumbnails
- backend/static/stl

into:
- _private/runtime_archive/<timestamp>/

The runtime folders remain in place so new uploads keep working.
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$ArchiveName = ""
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

if ([string]::IsNullOrWhiteSpace($ArchiveName)) {
    $ArchiveName = Get-Date -Format "yyyyMMdd-HHmmss"
}

$archiveRoot = Join-Path $ProjectRoot "_private\runtime_archive\$ArchiveName"
$targets = @(
    @{ Source = "backend\uploads"; Target = "backend\uploads" },
    @{ Source = "backend\static\thumbnails"; Target = "backend\static\thumbnails" },
    @{ Source = "backend\static\stl"; Target = "backend\static\stl" }
)

foreach ($item in $targets) {
    $src = Join-Path $ProjectRoot $item.Source
    $dst = Join-Path $archiveRoot $item.Target

    New-Item -ItemType Directory -Force -Path $src | Out-Null
    New-Item -ItemType Directory -Force -Path $dst | Out-Null

    $files = @(Get-ChildItem -LiteralPath $src -Force -File -ErrorAction SilentlyContinue)
    foreach ($file in $files) {
        Move-Item -LiteralPath $file.FullName -Destination (Join-Path $dst $file.Name)
    }

    Write-Host ("Archived {0} file(s) from {1}" -f $files.Count, $item.Source)
}

Write-Host "Archive root: $archiveRoot"
