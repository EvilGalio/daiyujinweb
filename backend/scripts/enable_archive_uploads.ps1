[CmdletBinding()]
param(
    [Alias("PythonExe")]
    [string]$BackendPythonExe = "",
    [string]$OccPythonExe = "",
    [string]$DatabaseUrl = "",
    [switch]$SkipDependencyInstall,
    [switch]$SkipBackup,
    [switch]$AllowMissingRarTool,
    [switch]$EnableAsyncArchives,
    [switch]$DisableAsyncArchives,
    [string]$EnvironmentFile = "",
    [switch]$Production,
    [switch]$Development
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Assert-NoReparsePathBeforeCommon {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [IO.Path]::GetFullPath($Path)
    $pathRoot = [IO.Path]::GetPathRoot($resolved)
    $current = $pathRoot
    foreach ($segment in $resolved.Substring($pathRoot.Length).Split(
        [char[]]@('\', '/'),
        [StringSplitOptions]::RemoveEmptyEntries
    )) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) {
            continue
        }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (
            ([IO.FileAttributes]$item.Attributes -band
                [IO.FileAttributes]::ReparsePoint) -ne 0
        ) {
            throw "Precision Tools archive bootstrap path contains a reparse point"
        }
    }
}

function Assert-PrecisionToolsBootstrapSource {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$CommonPath
    )

    $root = [IO.Path]::GetFullPath($SourceRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $common = [IO.Path]::GetFullPath($CommonPath)
    if (
        -not $common.StartsWith(
            $root + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not (Test-Path -LiteralPath $root -PathType Container) -or
        -not (Test-Path -LiteralPath $common -PathType Leaf)
    ) {
        throw "Precision Tools bootstrap source is missing or escapes its root"
    }
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $operatorSid = if ($currentSid -match "^S-1-5-21-(?:\d+-){3}\d+$") {
        $currentSid
    }
    else {
        ""
    }
    $trustedSids = @("S-1-5-18", "S-1-5-32-544")
    if ($operatorSid) {
        $trustedSids += $operatorSid
    }
    try {
        $trustedSids += [Security.Principal.NTAccount]::new(
            "NT SERVICE",
            "TrustedInstaller"
        ).Translate([Security.Principal.SecurityIdentifier]).Value
    }
    catch {
        # TrustedInstaller is unavailable on some Windows editions.
    }
    $trustedSids = @($trustedSids | Select-Object -Unique)
    $writeRights = [int64](
        [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::CreateFiles -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::CreateDirectories -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    )
    foreach ($path in @($root, $common)) {
        Assert-NoReparsePathBeforeCommon -Path $path
        $acl = Get-Acl -LiteralPath $path
        $owner = $acl.GetOwner(
            [Security.Principal.SecurityIdentifier]
        ).Value
        if ($owner -notin $trustedSids) {
            throw "Precision Tools bootstrap source has an untrusted owner"
        }
        foreach ($rule in $acl.GetAccessRules(
            $true,
            $true,
            [Security.Principal.SecurityIdentifier]
        )) {
            if (
                $rule.AccessControlType -eq
                    [Security.AccessControl.AccessControlType]::Allow -and
                [string]$rule.IdentityReference.Value -notin $trustedSids -and
                (([int64]$rule.FileSystemRights -band $writeRights) -ne 0)
            ) {
                throw "Precision Tools bootstrap source is writable by an untrusted principal"
            }
        }
    }
    return $operatorSid
}

$repoCandidate = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$RepoRoot = (Resolve-Path -LiteralPath $repoCandidate).Path
$BackendRoot = Join-Path $RepoRoot "backend"
$environmentCommon = Join-Path $RepoRoot "PrecisionToolsEnvironment.Common.ps1"
$sourceOperatorSid = [string](Assert-PrecisionToolsBootstrapSource `
    -SourceRoot $RepoRoot `
    -CommonPath $environmentCommon)
. $environmentCommon
$RepoRoot = Assert-PrecisionToolsPathContained `
    -Path $RepoRoot `
    -Root $RepoRoot `
    -Label "Precision Tools repository root"
$BackendRoot = Join-Path $RepoRoot "backend"
if ($Production -eq $Development) {
    throw "Select exactly one of -Production or -Development"
}
if ($Production) {
    if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
        throw "Production archive setup requires explicit -EnvironmentFile"
    }
    $EnvFile = Assert-PrecisionToolsProductionEnvironmentFile `
        -Path $EnvironmentFile
    Import-PrecisionToolsEnvironmentFile `
        -Path $EnvFile `
        -Production `
        -Profile Application
}
else {
    if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
        $EnvironmentFile = Join-Path $BackendRoot ".env"
    }
    $EnvFile = [IO.Path]::GetFullPath($EnvironmentFile)
    Import-PrecisionToolsEnvironmentFile `
        -Path $EnvFile `
        -AllowMissing
}
$RepairScript = Join-Path $PSScriptRoot "repair_allowed_extensions.py"
$WorkerScript = Join-Path $PSScriptRoot "run_quote_worker.py"
$Requirements = Join-Path $BackendRoot "requirements.lock"
if ($Production) {
    foreach ($sourcePath in @($RepairScript, $WorkerScript, $Requirements)) {
        [void](Assert-PrecisionToolsTrustedSourceFile `
            -Path $sourcePath `
            -SourceRoot $RepoRoot `
            -Label "Precision Tools archive setup source" `
            -DeploymentOperatorSid $sourceOperatorSid)
    }
}

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*?)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Set-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value,
        [switch]$OnlyIfMissing
    )

    $lines = @()
    if (Test-Path -LiteralPath $Path) {
        $lines = @([System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8))
    }
    $pattern = "^\s*$([regex]::Escape($Key))\s*="
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $index = $i
            break
        }
    }
    if ($index -ge 0) {
        if ($OnlyIfMissing) {
            return
        }
        $lines[$index] = "$Key=$Value"
    }
    else {
        $lines += "$Key=$Value"
    }
    [System.IO.File]::WriteAllLines($Path, $lines, $Utf8NoBom)
}

function Resolve-PythonPath {
    param(
        [string]$RequestedPath,
        [string]$EnvironmentName,
        [string[]]$FallbackPaths,
        [string]$ProbeCode = "",
        [switch]$StrictProduction,
        [string[]]$AllowedRoots = @()
    )

    $candidates = @()
    if ($RequestedPath) {
        $candidates += $RequestedPath
    }
    $fileValue = Get-EnvValue -Path $EnvFile -Key $EnvironmentName
    if ($fileValue) {
        $candidates += $fileValue
    }
    if (-not $StrictProduction) {
        $processValue = [Environment]::GetEnvironmentVariable(
            $EnvironmentName,
            "Process"
        )
        if ($processValue) {
            $candidates += $processValue
        }
        $candidates += $FallbackPaths
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $resolved = if ($StrictProduction) {
                Assert-PrecisionToolsTrustedExecutable `
                    -Path $candidate `
                    -AllowedRoots $AllowedRoots `
                    -Label "Precision Tools $EnvironmentName" `
                    -DeploymentOperatorSid $sourceOperatorSid
            }
            else {
                (Resolve-Path -LiteralPath $candidate).Path
            }
            if ($ProbeCode) {
                & $resolved -E -B -c $ProbeCode 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    continue
                }
            }
            return $resolved
        }
    }
    throw "$EnvironmentName is not configured with a usable absolute path."
}

function Invoke-Python {
    param(
        [string]$Executable,
        [string[]]$Arguments,
        [string]$Name
    )

    Write-Host $Name
    $effectiveArguments = if ($Production) {
        @("-E") + $Arguments
    }
    else {
        $Arguments
    }
    & $Executable @effectiveArguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Find-RarTool {
    $programFilesRoots = @(
        [Environment]::GetFolderPath(
            [Environment+SpecialFolder]::ProgramFiles
        ),
        [Environment]::GetFolderPath(
            [Environment+SpecialFolder]::ProgramFilesX86
        ),
        "C:\ProgramData\Daiyujin\Dependencies"
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $configured = if ($Production) {
        @((Get-EnvValue -Path $EnvFile -Key "RAR_EXTRACTION_TOOL"))
    }
    else {
        @(
            $env:RAR_EXTRACTION_TOOL,
            (Get-EnvValue -Path $EnvFile -Key "RAR_EXTRACTION_TOOL")
        )
    }
    foreach ($path in $configured | Select-Object -Unique) {
        if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
            if ($Production) {
                return Assert-PrecisionToolsTrustedExecutable `
                    -Path $path `
                    -AllowedRoots $programFilesRoots `
                    -Label "Precision Tools RAR extractor" `
                    -DeploymentOperatorSid $sourceOperatorSid
            }
            return (Resolve-Path -LiteralPath $path).Path
        }
    }

    if (-not $Production) {
        foreach ($toolName in @("7z.exe", "unrar.exe", "unar.exe", "bsdtar.exe")) {
            $tool = Get-Command $toolName -ErrorAction SilentlyContinue
            if ($tool -and $tool.Source -and (Test-Path -LiteralPath $tool.Source -PathType Leaf)) {
                return (Resolve-Path -LiteralPath $tool.Source).Path
            }
        }
    }

    foreach ($toolPath in @(
        "C:\Program Files\7-Zip\7z.exe",
        "C:\Program Files\WinRAR\UnRAR.exe"
    )) {
        if (Test-Path -LiteralPath $toolPath -PathType Leaf) {
            if ($Production) {
                return Assert-PrecisionToolsTrustedExecutable `
                    -Path $toolPath `
                    -AllowedRoots $programFilesRoots `
                    -Label "Precision Tools RAR extractor" `
                    -DeploymentOperatorSid $sourceOperatorSid
            }
            return (Resolve-Path -LiteralPath $toolPath).Path
        }
    }
    return ""
}

if ($EnableAsyncArchives -and $DisableAsyncArchives) {
    throw "EnableAsyncArchives and DisableAsyncArchives cannot be used together."
}

$commonPythonPaths = if ($Development) {
    @(
        (Join-Path $RepoRoot ".venv\Scripts\python.exe"),
        (Join-Path $BackendRoot ".venv\Scripts\python.exe"),
        (Join-Path $env:USERPROFILE "miniconda3\envs\occ\python.exe"),
        (Join-Path $env:USERPROFILE "anaconda3\envs\occ\python.exe"),
        (Join-Path $env:ProgramFiles "Python313\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        "D:\anaconda\envs\occ\python.exe",
        "D:\anaconda\python.exe"
    )
}
else {
    @()
}
$BackendPythonExe = Resolve-PythonPath `
    -RequestedPath $BackendPythonExe `
    -EnvironmentName "BACKEND_PYTHON" `
    -FallbackPaths $commonPythonPaths `
    -StrictProduction:$Production `
    -AllowedRoots @((Join-Path $RepoRoot ".venv"))
$OccPythonExe = Resolve-PythonPath `
    -RequestedPath $OccPythonExe `
    -EnvironmentName "OCC_PYTHON" `
    -FallbackPaths (@($BackendPythonExe) + $commonPythonPaths) `
    -ProbeCode "from OCC.Core.BRep import BRep_Tool" `
    -StrictProduction:$Production `
    -AllowedRoots @("C:\ProgramData\Daiyujin\Dependencies")
if ($Production) {
    $expectedBackendPython = [IO.Path]::GetFullPath(
        (Join-Path $RepoRoot ".venv\Scripts\python.exe")
    )
    $expectedOccPython = [IO.Path]::GetFullPath(
        "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
    )
    if (
        -not ([IO.Path]::GetFullPath($BackendPythonExe)).Equals(
            $expectedBackendPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not ([IO.Path]::GetFullPath($OccPythonExe)).Equals(
            $expectedOccPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not ([IO.Path]::GetFullPath($env:BACKEND_PYTHON)).Equals(
            $expectedBackendPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not ([IO.Path]::GetFullPath($env:OCC_PYTHON)).Equals(
            $expectedOccPython,
            [StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Production archive setup requires the fixed Python runtimes"
    }
}

Write-Host "Repo:            $RepoRoot"
Write-Host "BACKEND_PYTHON:  $BackendPythonExe"
Write-Host "OCC_PYTHON:      $OccPythonExe"

Push-Location -LiteralPath $BackendRoot
try {
    if (-not $SkipDependencyInstall) {
        Invoke-Python `
            -Executable $BackendPythonExe `
            -Arguments @("-m", "pip", "install", "--disable-pip-version-check", "-r", $Requirements) `
            -Name "Installing complete backend requirements"
    }

    Invoke-Python `
        -Executable $BackendPythonExe `
        -Arguments @("-B", "-c", "import flask, sqlalchemy, waitress, py7zr, rarfile") `
        -Name "Validating backend runtime"
    Invoke-Python `
        -Executable $OccPythonExe `
        -Arguments @("-B", "-c", "from OCC.Core.BRep import BRep_Tool") `
        -Name "Validating OCC runtime"

    $repairArgs = @("-B", $RepairScript)
    if ($SkipBackup) {
        $repairArgs += "--no-backup"
    }
    $previousDatabaseUrl = [Environment]::GetEnvironmentVariable(
        "DATABASE_URL",
        "Process"
    )
    try {
        if ($DatabaseUrl) {
            [Environment]::SetEnvironmentVariable(
                "DATABASE_URL",
                $DatabaseUrl,
                [EnvironmentVariableTarget]::Process
            )
        }
        Invoke-Python `
            -Executable $BackendPythonExe `
            -Arguments $repairArgs `
            -Name "Repairing archive extension settings"
    }
    finally {
        [Environment]::SetEnvironmentVariable(
            "DATABASE_URL",
            $previousDatabaseUrl,
            [EnvironmentVariableTarget]::Process
        )
        $DatabaseUrl = ""
    }

    if (-not (Test-Path -LiteralPath $WorkerScript -PathType Leaf)) {
        throw "Quote worker entrypoint not found: $WorkerScript"
    }
    Invoke-Python `
        -Executable $BackendPythonExe `
        -Arguments @("-B", $WorkerScript, "--init-db") `
        -Name "Initializing the quote job database"
}
finally {
    Pop-Location
}

$rarTool = Find-RarTool
if (-not $rarTool) {
    if (-not $AllowMissingRarTool) {
        throw "RAR extraction tool not found. Install 7-Zip or UnRAR, then rerun. Use -AllowMissingRarTool only when RAR is intentionally disabled."
    }
    Write-Warning "RAR extraction is unavailable because no supported extractor was found."
}
else {
    $rarProbe = "import subprocess,sys; subprocess.run([sys.argv[1]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)"
    Invoke-Python `
        -Executable $BackendPythonExe `
        -Arguments @("-B", "-c", $rarProbe, $rarTool) `
        -Name "Validating RAR extractor executable"
    Write-Host "RAR extractor:    $rarTool"
}

$environmentUpdates = @{
    BACKEND_PYTHON = $BackendPythonExe
    OCC_PYTHON = $OccPythonExe
    QUOTE_CAD_CONCURRENCY = "2"
}
if ($rarTool) {
    $environmentUpdates["RAR_EXTRACTION_TOOL"] = $rarTool
}
if ($EnableAsyncArchives) {
    $environmentUpdates["QUOTE_ASYNC_ARCHIVES_ENABLED"] = "1"
}
elseif ($DisableAsyncArchives) {
    $environmentUpdates["QUOTE_ASYNC_ARCHIVES_ENABLED"] = "0"
}
else {
    $environmentUpdates["QUOTE_ASYNC_ARCHIVES_ENABLED"] = "0"
}
if ($Production) {
    $onlyIfMissing = @("QUOTE_CAD_CONCURRENCY")
    if (-not $EnableAsyncArchives -and -not $DisableAsyncArchives) {
        $onlyIfMissing += "QUOTE_ASYNC_ARCHIVES_ENABLED"
    }
    Set-PrecisionToolsEnvironmentValues `
        -Path $EnvFile `
        -Values $environmentUpdates `
        -OnlyIfMissing $onlyIfMissing
}
else {
    foreach ($entry in $environmentUpdates.GetEnumerator()) {
        $onlyIfMissing = (
            $entry.Key -eq "QUOTE_CAD_CONCURRENCY" -or
            (
                $entry.Key -eq "QUOTE_ASYNC_ARCHIVES_ENABLED" -and
                -not $EnableAsyncArchives -and
                -not $DisableAsyncArchives
            )
        )
        Set-EnvValue `
            -Path $EnvFile `
            -Key $entry.Key `
            -Value ([string]$entry.Value) `
            -OnlyIfMissing:$onlyIfMissing
    }
}

$featureValue = Get-EnvValue -Path $EnvFile -Key "QUOTE_ASYNC_ARCHIVES_ENABLED"
Write-Host "Async archives:   $featureValue"
Write-Host "PASS: Backend dependencies, OCC runtime, archive support, and quote job database are ready."
Write-Host "Restart run-quote-worker.ps1 and run-api.ps1 to load these settings."
