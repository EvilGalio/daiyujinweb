[CmdletBinding()]
param(
    [ValidateSet("default", "mfg", "gcindus", "gcnov")]
    [string]$Theme = "default",
    [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-ForbiddenPluginPath {
    param([string]$RelativePath)

    $normalized = $RelativePath.Replace("\", "/")
    return (
        $normalized -match (
            "(?i)(^|/)(\.git|_private|uploads?|backups?|logs?|" +
            "tests?|test-output|data|\.pytest_cache|__pycache__|" +
            "htmlcov|\.mypy_cache|\.ruff_cache|\.tox|\.venv|venv|" +
            "node_modules)(/|$)"
        ) -or
        $normalized -match "(?i)(^|/)\.env(?:\.|$)" -or
        $normalized -match (
            "(?i)\.(db|sqlite|sqlite3|log|zip|7z|rar|bak|pyc|pyo|" +
            "key|pem|pfx|p12|jks|keystore|map)$"
        ) -or
        $normalized -match (
            "(?i)(^|/)(\.coverage|coverage\.xml|junit\.xml|pytest\.xml)$"
        ) -or
        $normalized -match "(?i)(^|/)(thumbs\.db|\.ds_store)$" -or
        $normalized -match "(?i)(secret|password|token)"
    )
}

function Get-Sha256 {
    param([string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return (
            [BitConverter]::ToString($algorithm.ComputeHash($stream))
        ).Replace("-", "")
    }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

$root = [IO.Path]::GetFullPath($PSScriptRoot)
$sourceRoot = Join-Path $root "daiyujin-tools"
$mainSource = Join-Path $sourceRoot "daiyujin-tools.php"
foreach ($requiredSource in @(
    $sourceRoot,
    $mainSource,
    (Join-Path $sourceRoot "assets"),
    (Join-Path $sourceRoot "templates")
)) {
    if (-not (Test-Path -LiteralPath $requiredSource)) {
        throw "Required plugin source was not found: $requiredSource"
    }
}

$php = Get-Content -Raw -LiteralPath $mainSource -Encoding UTF8
$headerVersion = [regex]::Match(
    $php,
    "(?m)^\s*\*\s*Version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$"
)
$constantVersion = [regex]::Match(
    $php,
    "define\(\s*'DYJ_TOOLS_VERSION'\s*,\s*'([0-9]+\.[0-9]+\.[0-9]+)'\s*\)"
)
if (-not $headerVersion.Success -or -not $constantVersion.Success) {
    throw "Plugin version metadata could not be read"
}
$version = $headerVersion.Groups[1].Value
if ($version -cne $constantVersion.Groups[1].Value) {
    throw "Plugin header and DYJ_TOOLS_VERSION do not match"
}

$sourceItems = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force)
$reparsePoints = @(
    $sourceItems | Where-Object {
        $_.Attributes -band [IO.FileAttributes]::ReparsePoint
    }
)
if ($reparsePoints.Count -ne 0) {
    throw "Plugin source must not contain reparse points"
}
$sourceFiles = @($sourceItems | Where-Object { -not $_.PSIsContainer })
foreach ($file in $sourceFiles) {
    $relative = $file.FullName.Substring($sourceRoot.Length + 1)
    if (Test-ForbiddenPluginPath -RelativePath $relative) {
        throw "Forbidden plugin source path: $relative"
    }
}

$artifactRoot = Join-Path $root "_private\artifacts\wordpress"
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $artifactRoot (
        "daiyujin-tools-{0}-{1}.zip" -f $version, $Theme
    )
}
$outputZip = [IO.Path]::GetFullPath($OutputPath)
$outputParent = Split-Path -Parent $outputZip
if ([IO.Path]::GetExtension($outputZip) -cne ".zip") {
    throw "Plugin output path must use the .zip extension"
}
if ($outputZip.StartsWith(
    $sourceRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Plugin output must not be written inside the source directory"
}
if (Test-Path -LiteralPath $outputZip) {
    throw "Plugin output already exists; choose a new path: $outputZip"
}
[void](New-Item -ItemType Directory -Path $outputParent -Force)

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd(
    [IO.Path]::DirectorySeparatorChar
)
$stageRoot = [IO.Path]::GetFullPath(
    (Join-Path $tempBase (
        "daiyujin-tools-build-{0}" -f [Guid]::NewGuid().ToString("N")
    ))
)
if (-not $stageRoot.StartsWith(
    $tempBase + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "Refusing to use an unexpected plugin staging path"
}
$packageRoot = Join-Path $stageRoot "daiyujin-tools"
$candidateZip = Join-Path $outputParent (
    ".{0}.{1}.candidate.zip" -f
    [IO.Path]::GetFileNameWithoutExtension($outputZip),
    [Guid]::NewGuid().ToString("N")
)

try {
    [void](New-Item -ItemType Directory -Path $packageRoot)
    Get-ChildItem -LiteralPath $sourceRoot -Force |
        Copy-Item -Destination $packageRoot -Recurse -Force

    if ($Theme -ne "default") {
        $themesRoot = Join-Path $packageRoot "assets\css\themes"
        Get-ChildItem -LiteralPath $themesRoot -File |
            Where-Object { $_.BaseName -cne $Theme } |
            ForEach-Object {
                Remove-Item -LiteralPath $_.FullName -Force
            }
    }

    Compress-Archive -Path $packageRoot -DestinationPath $candidateZip

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($candidateZip)
    try {
        $entryNames = @(
            $archive.Entries |
                ForEach-Object { $_.FullName.Replace("\", "/") }
        )
        if ($entryNames.Count -eq 0) {
            throw "Plugin archive is empty"
        }
        foreach ($entryName in $entryNames) {
            if (-not $entryName.StartsWith(
                "daiyujin-tools/",
                [StringComparison]::Ordinal
            )) {
                throw "Plugin archive has an unexpected top-level entry: $entryName"
            }
            $relativeEntry = $entryName.Substring("daiyujin-tools/".Length)
            if (
                $relativeEntry -and
                (Test-ForbiddenPluginPath -RelativePath $relativeEntry)
            ) {
                throw "Plugin archive contains a forbidden path: $entryName"
            }
        }
        foreach ($requiredEntry in @(
            "daiyujin-tools/daiyujin-tools.php",
            "daiyujin-tools/assets/js/quote.js",
            "daiyujin-tools/assets/css/plugins.css",
            "daiyujin-tools/templates/quote.php",
            "daiyujin-tools/templates/portal-entry.php"
        )) {
            if ($requiredEntry -notin $entryNames) {
                throw "Plugin archive is missing: $requiredEntry"
            }
        }

        $buffer = New-Object byte[] 65536
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith("/")) {
                continue
            }
            $stream = $entry.Open()
            try {
                while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) {
                }
            }
            finally {
                $stream.Dispose()
            }
        }
    }
    finally {
        $archive.Dispose()
    }

    Move-Item -LiteralPath $candidateZip -Destination $outputZip
    $hash = Get-Sha256 -Path $outputZip
    [pscustomobject]@{
        Path = $outputZip
        Version = $version
        Theme = $Theme
        Entries = $entryNames.Count
        Sha256 = $hash
    }
}
finally {
    if (
        (Test-Path -LiteralPath $stageRoot -PathType Container) -and
        $stageRoot.StartsWith(
            $tempBase + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $candidateZip -PathType Leaf) {
        Remove-Item -LiteralPath $candidateZip -Force
    }
}
