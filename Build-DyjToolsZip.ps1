[CmdletBinding()]
param(
    [ValidateSet("default", "mfg", "gcindus", "gcnov")]
    [string]$Theme = "default",
    [string]$OutputPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$approvedPluginFiles = @(
    "README.md",
    "daiyujin-tools.php",
    "assets/css/order-portal.css",
    "assets/css/plugins.css",
    "assets/css/themes/gcindus.css",
    "assets/css/themes/gcnov.css",
    "assets/css/themes/mfg.css",
    "assets/js/api.js",
    "assets/js/config.js",
    "assets/js/freight.js",
    "assets/js/material-standards.js",
    "assets/js/material-weight-shapes.js",
    "assets/js/material-weight.js",
    "assets/js/order-portal.js",
    "assets/js/quote-3d-viewer.js",
    "assets/js/quote.js",
    "assets/js/tolerance.js",
    "templates/contact-router.php",
    "templates/freight.php",
    "templates/material-standards.php",
    "templates/material-weight.php",
    "templates/order-portal.php",
    "templates/portal-entry.php",
    "templates/quote.php",
    "templates/tolerance.php"
)
$approvedPluginDirectories = @(
    "assets",
    "assets/css",
    "assets/css/themes",
    "assets/js",
    "templates"
)
$textPluginExtensions = @(".css", ".js", ".json", ".md", ".php", ".txt")

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

function Test-ForbiddenPluginText {
    param([AllowEmptyString()][string]$Content)

    foreach ($pattern in @(
        "(?i)-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----",
        "(?i)\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
        "(?i)\bgh[pousr]_[A-Za-z0-9]{30,}\b",
        "(?i)\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b",
        (
            "(?i)\b(?:postgres(?:ql)?|mysql|mariadb|redis|rediss|" +
            "amqp|amqps)://[^/\s:@]+:[^@\s/]+@"
        ),
        (
            "(?im)(?:^|[,{;]\s*)[""']?[A-Z0-9_]*" +
            "(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)" +
            "[A-Z0-9_]*[""']?\s*[:=]\s*[""'][^""']{16,}[""']"
        ),
        (
            "(?i)define\(\s*[""'][A-Z0-9_]*" +
            "(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)" +
            "[A-Z0-9_]*[""']\s*,\s*[""'][^""']{16,}[""']"
        )
    )) {
        if ($Content -match $pattern) {
            return $true
        }
    }
    return $false
}

function Test-ForbiddenPluginContent {
    param([string]$Path)

    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -notin $textPluginExtensions) {
        return $false
    }
    $content = [string](Get-Content -Raw -LiteralPath $Path -Encoding UTF8)
    return Test-ForbiddenPluginText -Content $content
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

function Get-StreamSha256 {
    param([Parameter(Mandatory = $true)][IO.Stream]$Stream)

    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return (
            [BitConverter]::ToString($algorithm.ComputeHash($Stream))
        ).Replace("-", "")
    }
    finally {
        $algorithm.Dispose()
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
$sourceRootItem = Get-Item -LiteralPath $sourceRoot -Force
if (
    ([IO.FileAttributes]$sourceRootItem.Attributes -band
        [IO.FileAttributes]::ReparsePoint) -ne 0
) {
    throw "Plugin source root must not be a reparse point"
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
$approvedFileSet = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
)
foreach ($approvedFile in $approvedPluginFiles) {
    [void]$approvedFileSet.Add($approvedFile)
}
$approvedDirectorySet = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
)
foreach ($approvedDirectory in $approvedPluginDirectories) {
    [void]$approvedDirectorySet.Add($approvedDirectory)
}
$actualFileSet = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
)
$sourceHashes = [Collections.Generic.Dictionary[string, string]]::new(
    [StringComparer]::Ordinal
)
foreach ($file in $sourceFiles) {
    $relative = $file.FullName.Substring($sourceRoot.Length + 1).Replace("\", "/")
    if (Test-ForbiddenPluginPath -RelativePath $relative) {
        throw "Forbidden plugin source path: $relative"
    }
    if (-not $approvedFileSet.Contains($relative)) {
        throw "Plugin source manifest has an unexpected file: $relative"
    }
    if (Test-ForbiddenPluginContent -Path $file.FullName) {
        throw "Plugin source contains credential-like content: $relative"
    }
    [void]$actualFileSet.Add($relative)
    $sourceHashes.Add($relative, (Get-Sha256 -Path $file.FullName))
}
foreach ($approvedFile in $approvedPluginFiles) {
    if (-not $actualFileSet.Contains($approvedFile)) {
        throw "Plugin source manifest is missing a required file: $approvedFile"
    }
}
foreach ($directory in @($sourceItems | Where-Object { $_.PSIsContainer })) {
    $relative = $directory.FullName.Substring(
        $sourceRoot.Length + 1
    ).Replace("\", "/")
    if (-not $approvedDirectorySet.Contains($relative)) {
        throw "Plugin source manifest has an unexpected directory: $relative"
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
$expectedPackageFiles = @(
    $approvedPluginFiles | Where-Object {
        $Theme -eq "default" -or
        -not $_.StartsWith(
            "assets/css/themes/",
            [StringComparison]::Ordinal
        ) -or
        $_ -ceq "assets/css/themes/$Theme.css"
    }
)
$expectedPackageFileSet = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
)
$expectedPackageRelativeSet = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
)
foreach ($expectedPackageFile in $expectedPackageFiles) {
    [void]$expectedPackageRelativeSet.Add($expectedPackageFile)
    [void]$expectedPackageFileSet.Add(
        "daiyujin-tools/$expectedPackageFile"
    )
}
$expectedArchiveDirectorySet = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
)
[void]$expectedArchiveDirectorySet.Add("daiyujin-tools/")
foreach ($approvedDirectory in $approvedPluginDirectories) {
    [void]$expectedArchiveDirectorySet.Add(
        "daiyujin-tools/$approvedDirectory/"
    )
}

$outputPublished = $false
$outputVerified = $false
try {
    [void](New-Item -ItemType Directory -Path $packageRoot)
    foreach ($approvedDirectory in $approvedPluginDirectories) {
        [void](New-Item -ItemType Directory -Path (
            Join-Path $packageRoot $approvedDirectory
        ))
    }
    foreach ($expectedPackageFile in $expectedPackageFiles) {
        $sourcePath = Join-Path $sourceRoot $expectedPackageFile
        $sourceItem = Get-Item -LiteralPath $sourcePath -Force
        if (
            ([IO.FileAttributes]$sourceItem.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "Plugin source changed to a reparse point during packaging"
        }
        Copy-Item -LiteralPath $sourcePath -Destination (
            Join-Path $packageRoot $expectedPackageFile
        )
    }

    $sourceRootAfter = Get-Item -LiteralPath $sourceRoot -Force
    if (
        ([IO.FileAttributes]$sourceRootAfter.Attributes -band
            [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
        throw "Plugin source root changed to a reparse point during packaging"
    }
    $sourceItemsAfter = @(
        Get-ChildItem -LiteralPath $sourceRoot -Recurse -Force
    )
    if (@(
        $sourceItemsAfter | Where-Object {
            $_.Attributes -band [IO.FileAttributes]::ReparsePoint
        }
    ).Count -ne 0) {
        throw "Plugin source gained a reparse point during packaging"
    }
    $sourceFilesAfter = @(
        $sourceItemsAfter | Where-Object { -not $_.PSIsContainer }
    )
    $sourceFileSetAfter = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::Ordinal
    )
    foreach ($file in $sourceFilesAfter) {
        $relative = $file.FullName.Substring(
            $sourceRoot.Length + 1
        ).Replace("\", "/")
        if (
            (Test-ForbiddenPluginPath -RelativePath $relative) -or
            -not $approvedFileSet.Contains($relative)
        ) {
            throw "Plugin source manifest changed during packaging"
        }
        if (Test-ForbiddenPluginContent -Path $file.FullName) {
            throw "Plugin source gained credential-like content during packaging"
        }
        if (
            -not $sourceHashes.ContainsKey($relative) -or
            (Get-Sha256 -Path $file.FullName) -cne $sourceHashes[$relative]
        ) {
            throw "Plugin source content changed during packaging"
        }
        [void]$sourceFileSetAfter.Add($relative)
    }
    if ($sourceFileSetAfter.Count -ne $approvedPluginFiles.Count) {
        throw "Plugin source file manifest changed during packaging"
    }
    foreach ($approvedFile in $approvedPluginFiles) {
        if (-not $sourceFileSetAfter.Contains($approvedFile)) {
            throw "Plugin source file manifest changed during packaging"
        }
    }
    $sourceDirectorySetAfter = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::Ordinal
    )
    foreach ($directory in @(
        $sourceItemsAfter | Where-Object { $_.PSIsContainer }
    )) {
        $relative = $directory.FullName.Substring(
            $sourceRoot.Length + 1
        ).Replace("\", "/")
        if (-not $approvedDirectorySet.Contains($relative)) {
            throw "Plugin source directory manifest changed during packaging"
        }
        [void]$sourceDirectorySetAfter.Add($relative)
    }
    if ($sourceDirectorySetAfter.Count -ne $approvedPluginDirectories.Count) {
        throw "Plugin source directory manifest changed during packaging"
    }

    $packageRootItem = Get-Item -LiteralPath $packageRoot -Force
    if (
        ([IO.FileAttributes]$packageRootItem.Attributes -band
            [IO.FileAttributes]::ReparsePoint) -ne 0
    ) {
        throw "Plugin staging root must not be a reparse point"
    }
    $packageItems = @(
        Get-ChildItem -LiteralPath $packageRoot -Recurse -Force
    )
    if (@(
        $packageItems | Where-Object {
            $_.Attributes -band [IO.FileAttributes]::ReparsePoint
        }
    ).Count -ne 0) {
        throw "Plugin staging tree must not contain reparse points"
    }
    $packageFileSet = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::Ordinal
    )
    foreach ($file in @(
        $packageItems | Where-Object { -not $_.PSIsContainer }
    )) {
        $relative = $file.FullName.Substring(
            $packageRoot.Length + 1
        ).Replace("\", "/")
        if (
            (Test-ForbiddenPluginPath -RelativePath $relative) -or
            -not $expectedPackageRelativeSet.Contains($relative)
        ) {
            throw "Plugin staging file manifest is invalid"
        }
        if (Test-ForbiddenPluginContent -Path $file.FullName) {
            throw "Plugin staging contains credential-like content"
        }
        if (
            -not $sourceHashes.ContainsKey($relative) -or
            (Get-Sha256 -Path $file.FullName) -cne $sourceHashes[$relative]
        ) {
            throw "Plugin staging content differs from the reviewed source"
        }
        [void]$packageFileSet.Add($relative)
    }
    if ($packageFileSet.Count -ne $expectedPackageFiles.Count) {
        throw "Plugin staging file manifest is incomplete"
    }
    foreach ($expectedPackageFile in $expectedPackageFiles) {
        if (-not $packageFileSet.Contains($expectedPackageFile)) {
            throw "Plugin staging file manifest is incomplete"
        }
    }
    $packageDirectorySet = [Collections.Generic.HashSet[string]]::new(
        [StringComparer]::Ordinal
    )
    foreach ($directory in @(
        $packageItems | Where-Object { $_.PSIsContainer }
    )) {
        $relative = $directory.FullName.Substring(
            $packageRoot.Length + 1
        ).Replace("\", "/")
        if (-not $approvedDirectorySet.Contains($relative)) {
            throw "Plugin staging directory manifest is invalid"
        }
        [void]$packageDirectorySet.Add($relative)
    }
    if ($packageDirectorySet.Count -ne $approvedPluginDirectories.Count) {
        throw "Plugin staging directory manifest is incomplete"
    }

    $stagedPhp = Get-Content -Raw -LiteralPath (
        Join-Path $packageRoot "daiyujin-tools.php"
    ) -Encoding UTF8
    $stagedHeaderVersion = [regex]::Match(
        $stagedPhp,
        "(?m)^\s*\*\s*Version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$"
    )
    $stagedConstantVersion = [regex]::Match(
        $stagedPhp,
        "define\(\s*'DYJ_TOOLS_VERSION'\s*,\s*'([0-9]+\.[0-9]+\.[0-9]+)'\s*\)"
    )
    if (
        -not $stagedHeaderVersion.Success -or
        -not $stagedConstantVersion.Success -or
        $stagedHeaderVersion.Groups[1].Value -cne $version -or
        $stagedConstantVersion.Groups[1].Value -cne $version
    ) {
        throw "Staged plugin version metadata does not match reviewed source"
    }

    Compress-Archive -Path $packageRoot -DestinationPath $candidateZip
    $candidateArchiveHash = Get-Sha256 -Path $candidateZip

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
            if (
                -not $entryName.EndsWith("/") -and
                -not $expectedPackageFileSet.Contains($entryName)
            ) {
                throw "Plugin archive has an unexpected file: $entryName"
            }
            if (
                $entryName.EndsWith("/") -and
                -not $expectedArchiveDirectorySet.Contains($entryName)
            ) {
                throw "Plugin archive has an unexpected directory: $entryName"
            }
        }
        $archiveFileNames = @(
            $entryNames | Where-Object { -not $_.EndsWith("/") }
        )
        if ($archiveFileNames.Count -ne $expectedPackageFiles.Count) {
            throw "Plugin archive does not match the approved file manifest"
        }
        foreach ($requiredEntry in $expectedPackageFileSet) {
            if ($requiredEntry -cnotin $archiveFileNames) {
                throw "Plugin archive is missing: $requiredEntry"
            }
        }

        foreach ($entry in $archive.Entries) {
            $entryName = $entry.FullName.Replace("\", "/")
            if ($entryName.EndsWith("/")) {
                continue
            }
            $relativeEntry = $entryName.Substring(
                "daiyujin-tools/".Length
            )
            $stream = $entry.Open()
            try {
                $archiveEntryHash = Get-StreamSha256 -Stream $stream
                if (
                    -not $sourceHashes.ContainsKey($relativeEntry) -or
                    $archiveEntryHash -cne $sourceHashes[$relativeEntry]
                ) {
                    throw "Plugin archive content differs from reviewed source"
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

    $validatedCandidateHash = Get-Sha256 -Path $candidateZip
    if ($validatedCandidateHash -cne $candidateArchiveHash) {
        throw "Plugin archive changed during validation"
    }
    Move-Item -LiteralPath $candidateZip -Destination $outputZip
    $outputPublished = $true
    $hash = Get-Sha256 -Path $outputZip
    if ($hash -cne $candidateArchiveHash) {
        throw "Published plugin archive differs from the verified candidate"
    }
    $outputVerified = $true
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
    if (
        $outputPublished -and
        -not $outputVerified -and
        (Test-Path -LiteralPath $outputZip -PathType Leaf)
    ) {
        Remove-Item -LiteralPath $outputZip -Force
    }
}
