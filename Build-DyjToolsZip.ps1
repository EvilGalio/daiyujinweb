# Build-DyjToolsZip.ps1 — Package themed Daiyujin Tools plugin
param(
    [ValidateSet("default","mfg","gcindus","gcnov")]
    [string]$Theme = "default"
)

$root = $PSScriptRoot
$src = "$root\daiyujin-tools"
$outDir = "$root\_private\artifacts\wordpress"
$outZip = "$outDir\daiyujin-tools-$Theme.zip"

Write-Host "Building themed plugin zip: $Theme"

# Create output dir
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Build in temp dir to keep source clean
$tmp = "$env:TEMP\daiyujin-tools-$Theme-$(Get-Date -Format 'yyyyMMddHHmmss')"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Copy-Item -Recurse $src $tmp

# Exclude files not needed in plugin
$exclude = @(".map", "*.log", ".git", ".DS_Store", "Thumbs.db", "_test_*")
foreach ($pattern in $exclude) {
    Get-ChildItem -Path $tmp -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue | Remove-Item -Force
}

# If theme is not default, remove unused theme CSS files
if ($Theme -ne "default") {
    Get-ChildItem -Path "$tmp\assets\css\themes" -File | Where-Object { $_.BaseName -ne $Theme } | Remove-Item -Force
}

# Create zip
Remove-Item $outZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$tmp\*" -DestinationPath $outZip -Force

Remove-Item -Recurse -Force $tmp
Write-Host "Done: $outZip"
