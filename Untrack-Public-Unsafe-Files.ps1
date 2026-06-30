<#
Remove public-unsafe files from the Git index without deleting local files.

Dry run:
  .\Untrack-Public-Unsafe-Files.ps1

Apply:
  .\Untrack-Public-Unsafe-Files.ps1 -Apply

This only runs `git rm --cached`. Local files remain on disk.
After applying, commit and push the removal commit.
#>

[CmdletBinding()]
param(
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

function Test-PublicUnsafePath {
    param([string]$Path)
    $p = $Path.Replace("\", "/")
    $lower = $p.ToLowerInvariant()

    if ($lower -like "backend/data/*") { return $true }
    if ($lower -like "backend/uploads/*") { return $true }
    if ($lower -like "backend/static/thumbnails/*") { return $true }
    if ($lower -like "backend/static/stl/*") { return $true }
    if ($lower -eq "backend/.env") { return $true }
    if ($lower -like "backend/*.db") { return $true }
    if ($lower -like "*.db") { return $true }
    if ($lower -like "*.sqlite") { return $true }
    if ($lower -like "*.sqlite3") { return $true }
    if ($lower -like "used_prd/*") { return $true }
    if ($lower -like "prd*.md") { return $true }
    if ($lower -like "guide*.md") { return $true }
    if ($lower -like "*.xlsx") { return $true }
    if ($lower -like "*.xls") { return $true }
    if ($lower -like "*.xlsm") { return $true }
    if ($lower -like "*.pdf") { return $true }
    if ($lower -like "*.zip") { return $true }
    if ($p -like "*报价*") { return $true }
    if ($p -like "*运费*") { return $true }
    if ($p -eq "Task 1 fromJohnson.md") { return $true }
    if ($p -eq "task 2 from Johnson.md") { return $true }

    return $false
}

$tracked = git ls-files
$unsafe = @($tracked | Where-Object { Test-PublicUnsafePath $_ })

if ($unsafe.Count -eq 0) {
    Write-Host "No public-unsafe tracked files found." -ForegroundColor Green
    exit 0
}

Write-Host "Public-unsafe tracked files:" -ForegroundColor Yellow
$unsafe | ForEach-Object { Write-Host "  $_" }
Write-Host ""

if (-not $Apply) {
    Write-Host "Dry run only. To untrack them without deleting local files, run:" -ForegroundColor Cyan
    Write-Host "  .\Untrack-Public-Unsafe-Files.ps1 -Apply"
    exit 0
}

Write-Host "Removing files from Git index. Local files will remain on disk..." -ForegroundColor Cyan

$batch = New-Object System.Collections.Generic.List[string]
foreach ($path in $unsafe) {
    $batch.Add($path)
    if ($batch.Count -ge 50) {
        git rm --cached -- @batch
        if ($LASTEXITCODE -ne 0) { throw "git rm --cached failed." }
        $batch.Clear()
    }
}

if ($batch.Count -gt 0) {
    git rm --cached -- @batch
    if ($LASTEXITCODE -ne 0) { throw "git rm --cached failed." }
}

Write-Host ""
Write-Host "Done. Review with:" -ForegroundColor Green
Write-Host "  git status --short"
Write-Host ""
Write-Host "Important: this removes files from future commits, but public Git history may still contain old copies."
