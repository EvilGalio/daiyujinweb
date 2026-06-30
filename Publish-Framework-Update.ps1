<#
Publish code/framework changes from the development PC to GitHub.

Usage:
  .\Publish-Framework-Update.ps1 -Message "Update quote UI and API"

This script refuses to publish if public-unsafe files are still tracked.
Run .\Untrack-Public-Unsafe-Files.ps1 -Apply first, then commit that cleanup.
#>

[CmdletBinding()]
param(
    [string]$Message = "",
    [string]$Remote = "origin",
    [string]$Branch = "",
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
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
    if ($lower -like "199*.md") { return $true }
    if ($p -like "DHL*运费*.md") { return $true }
    if ($p -like "几个小工具*") { return $true }
    if ($p -eq "力扣.md") { return $true }
    if ($p -like "*报价*") { return $true }
    if ($p -like "*运费*") { return $true }
    if ($p -eq "Task 1 fromJohnson.md") { return $true }
    if ($p -eq "task 2 from Johnson.md") { return $true }

    return $false
}

git rev-parse --is-inside-work-tree | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "This folder is not a Git repository."
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = (git branch --show-current).Trim()
}
if ([string]::IsNullOrWhiteSpace($Branch)) {
    throw "Cannot detect current branch. Pass -Branch explicitly."
}

$trackedUnsafe = @(git -c core.quotepath=false ls-files | Where-Object { Test-PublicUnsafePath $_ })
if ($trackedUnsafe.Count -gt 0) {
    Write-Host "Refusing to publish because public-unsafe files are still tracked:" -ForegroundColor Red
    $trackedUnsafe | Select-Object -First 80 | ForEach-Object { Write-Host "  $_" }
    if ($trackedUnsafe.Count -gt 80) {
        Write-Host "  ... and $($trackedUnsafe.Count - 80) more"
    }
    Write-Host ""
    Write-Host "Run this first:" -ForegroundColor Yellow
    Write-Host "  .\Untrack-Public-Unsafe-Files.ps1 -Apply"
    Write-Host "Then commit that cleanup once."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "Framework update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-Host "Staging framework/code changes..." -ForegroundColor Cyan
git add -A
if ($LASTEXITCODE -ne 0) { throw "git add failed." }

$blockedStaged = @()
$nameStatus = @(git -c core.quotepath=false diff --cached --name-status)
foreach ($line in $nameStatus) {
    $parts = $line -split "`t"
    if ($parts.Count -lt 2) { continue }
    $statusCode = $parts[0]
    $path = $parts[-1]

    # A deletion is allowed here because the cleanup commit must remove
    # public-unsafe files from the public repository while preserving them
    # locally through git rm --cached.
    if ((Test-PublicUnsafePath $path) -and ($statusCode -notlike "D*")) {
        $blockedStaged += "$statusCode`t$path"
    }
}

if ($blockedStaged.Count -gt 0) {
    Write-Host "Refusing to commit added/modified public-unsafe staged files:" -ForegroundColor Red
    $blockedStaged | ForEach-Object { Write-Host "  $_" }
    Write-Host "Only deletions from the Git index are allowed for public-unsafe paths."
    exit 1
}

$staged = @(git -c core.quotepath=false diff --cached --name-only)
if ($staged.Count -eq 0) {
    Write-Host "No publishable changes staged." -ForegroundColor Yellow
    exit 0
}

Write-Host "Files to commit:" -ForegroundColor Cyan
$staged | ForEach-Object { Write-Host "  $_" }
Write-Host ""

git commit -m $Message
if ($LASTEXITCODE -ne 0) { throw "git commit failed." }

if ($NoPush) {
    Write-Host "Committed locally. Skipping push because -NoPush was set." -ForegroundColor Green
    exit 0
}

git push $Remote $Branch
if ($LASTEXITCODE -ne 0) { throw "git push failed." }

Write-Host "Published to $Remote/$Branch." -ForegroundColor Green
