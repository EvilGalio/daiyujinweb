[CmdletBinding()]
param(
    [string]$BackendPython = "",
    [string]$OccPython = "",
    [int]$Concurrency = 0,
    [string]$LogPath = "",
    [string]$RuntimeTempRoot = "",
    [string]$EnvironmentFile = "",
    [string]$DeploymentOperatorSid = "",
    [switch]$Development,
    [switch]$NoRestart
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8NoBom
[Console]::InputEncoding = $Utf8NoBom
[Console]::OutputEncoding = $Utf8NoBom
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Test-BootstrapDeploymentOperatorSid {
    param([AllowEmptyString()][string]$Sid)

    return (
        -not [string]::IsNullOrWhiteSpace($Sid) -and
        $Sid -match "^S-1-5-21-(?:\d+-){3}\d+$"
    )
}

function Assert-PrecisionToolsBootstrapSource {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$CommonPath,
        [AllowEmptyString()][string]$OperatorSid = ""
    )

    if (
        -not [string]::IsNullOrWhiteSpace($OperatorSid) -and
        -not (Test-BootstrapDeploymentOperatorSid -Sid $OperatorSid)
    ) {
        throw "Precision Tools deployment operator SID is invalid"
    }
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
    $trustedSids = @("S-1-5-18", "S-1-5-32-544")
    if ($OperatorSid) {
        $trustedSids += $OperatorSid
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
        $resolved = [IO.Path]::GetFullPath($path)
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
                throw "Precision Tools bootstrap source contains a reparse point"
            }
        }
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
}

$ProjectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$BackendRoot = Join-Path $ProjectRoot "backend"
$environmentCommon = Join-Path $ProjectRoot "PrecisionToolsEnvironment.Common.ps1"
if ($Development -and [string]::IsNullOrWhiteSpace($DeploymentOperatorSid)) {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if (Test-BootstrapDeploymentOperatorSid -Sid $currentSid) {
        $DeploymentOperatorSid = $currentSid
    }
}
Assert-PrecisionToolsBootstrapSource `
    -SourceRoot $ProjectRoot `
    -CommonPath $environmentCommon `
    -OperatorSid $DeploymentOperatorSid
. $environmentCommon
$ProjectRoot = Assert-PrecisionToolsPathContained `
    -Path $ProjectRoot `
    -Root $ProjectRoot `
    -Label "Precision Tools project root"
$BackendRoot = Join-Path $ProjectRoot "backend"
if ($Development) {
    if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
        $EnvironmentFile = Join-Path $BackendRoot ".env"
    }
    Import-PrecisionToolsEnvironmentFile `
        -Path $EnvironmentFile `
        -AllowMissing
}
else {
    if ([string]::IsNullOrWhiteSpace($EnvironmentFile)) {
        throw "Production quote-worker launch requires explicit -EnvironmentFile"
    }
    Import-PrecisionToolsEnvironmentFile `
        -Path $EnvironmentFile `
        -Production `
        -Profile Application
    if (
        [string]::IsNullOrWhiteSpace($BackendPython) -or
        [string]::IsNullOrWhiteSpace($OccPython)
    ) {
        throw "Production quote-worker launch requires explicit Python runtimes"
    }
    if (
        [string]::IsNullOrWhiteSpace($LogPath) -or
        [string]::IsNullOrWhiteSpace($RuntimeTempRoot)
    ) {
        throw "Production quote-worker launch requires explicit runtime log and temp paths"
    }
}
$WorkerScript = Join-Path $BackendRoot "scripts\run_quote_worker.py"
$DataRoot = Join-Path $BackendRoot "data"
$PidFile = Join-Path $DataRoot "quote-worker-host.pid"
$LockFile = Join-Path $DataRoot "quote-worker-host.lock"
$transcriptStarted = $false
$lockStream = $null

if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    $LogPath = [IO.Path]::GetFullPath($LogPath)
    if (-not $Development) {
        [void](Assert-PrecisionToolsPathContained `
            -Path $LogPath `
            -Root "C:\ProgramData\Daiyujin\PrecisionTools\runtime\logs" `
            -Label "Precision Tools quote-worker log")
    }
    $logParent = Split-Path -Parent $LogPath
    if ($logParent) {
        if (-not (Test-Path -LiteralPath $logParent -PathType Container)) {
            if (-not $Development) {
                throw "Production quote-worker log directory was not prepared"
            }
            New-Item -ItemType Directory -Force -Path $logParent | Out-Null
        }
    }
    if ((Test-Path -LiteralPath $LogPath -PathType Leaf) -and (Get-Item -LiteralPath $LogPath).Length -ge 10MB) {
        $rotatedLog = "$LogPath.1"
        Remove-Item -LiteralPath $rotatedLog -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $LogPath -Destination $rotatedLog -Force
    }
    Start-Transcript -LiteralPath $LogPath -Append | Out-Null
    $transcriptStarted = $true
}

function Resolve-PythonPath {
    param(
        [string]$RequestedPath,
        [string]$EnvironmentName,
        [string[]]$FallbackPaths,
        [string]$ProbeCode = ""
    )

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $candidates += $RequestedPath
    }
    $configured = [Environment]::GetEnvironmentVariable($EnvironmentName, "Process")
    if (-not [string]::IsNullOrWhiteSpace($configured)) {
        $candidates += $configured
    }
    $candidates += $FallbackPaths

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $resolved = (Resolve-Path -LiteralPath $candidate).Path
            if ($ProbeCode) {
                & $resolved -B -c $ProbeCode 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    continue
                }
            }
            return $resolved
        }
    }
    throw "$EnvironmentName is not configured with a usable absolute path."
}

if (-not [string]::IsNullOrWhiteSpace($RuntimeTempRoot)) {
    $RuntimeTempRoot = [IO.Path]::GetFullPath($RuntimeTempRoot)
    if (-not $Development) {
        [void](Assert-PrecisionToolsPathContained `
            -Path $RuntimeTempRoot `
            -Root "C:\ProgramData\Daiyujin\PrecisionTools\runtime\temp" `
            -Label "Precision Tools quote-worker temporary directory")
    }
    if (-not (Test-Path -LiteralPath $RuntimeTempRoot -PathType Container)) {
        throw "Precision Tools worker runtime temp directory was not prepared"
    }
    $env:TEMP = $RuntimeTempRoot
    $env:TMP = $RuntimeTempRoot
}

if ($Development) {
    $commonPythonPaths = @(
        (Join-Path $ProjectRoot ".venv\Scripts\python.exe"),
        (Join-Path $BackendRoot ".venv\Scripts\python.exe"),
        (Join-Path $env:USERPROFILE "miniconda3\envs\occ\python.exe"),
        (Join-Path $env:USERPROFILE "anaconda3\envs\occ\python.exe"),
        (Join-Path $env:ProgramFiles "Python313\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        "D:\anaconda\envs\occ\python.exe",
        "D:\anaconda\python.exe"
    )
    $BackendPython = Resolve-PythonPath `
        -RequestedPath $BackendPython `
        -EnvironmentName "BACKEND_PYTHON" `
        -FallbackPaths $commonPythonPaths
    $OccPython = Resolve-PythonPath `
        -RequestedPath $OccPython `
        -EnvironmentName "OCC_PYTHON" `
        -FallbackPaths (@($BackendPython) + $commonPythonPaths) `
        -ProbeCode "from OCC.Core.BRep import BRep_Tool"
}
else {
    $expectedBackendPython = [IO.Path]::GetFullPath(
        (Join-Path $ProjectRoot ".venv\Scripts\python.exe")
    )
    $expectedOccPython = [IO.Path]::GetFullPath(
        "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
    )
    $requestedBackendPython = [IO.Path]::GetFullPath($BackendPython)
    $requestedOccPython = [IO.Path]::GetFullPath($OccPython)
    if (
        -not $requestedBackendPython.Equals(
            $expectedBackendPython,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        -not $requestedOccPython.Equals(
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
        throw "Production quote-worker Python runtimes do not match the protected contract"
    }
    $BackendPython = Assert-PrecisionToolsTrustedExecutable `
        -Path $requestedBackendPython `
        -AllowedRoots @((Join-Path $ProjectRoot ".venv")) `
        -Label "Precision Tools backend Python" `
        -DeploymentOperatorSid $DeploymentOperatorSid
    $OccPython = Assert-PrecisionToolsTrustedExecutable `
        -Path $requestedOccPython `
        -AllowedRoots @("C:\ProgramData\Daiyujin\Dependencies") `
        -Label "Precision Tools OCC Python" `
        -DeploymentOperatorSid $DeploymentOperatorSid
    if (
        $Concurrency -gt 0 -and
        $Concurrency -ne [int]$env:QUOTE_CAD_CONCURRENCY
    ) {
        throw "Production quote-worker concurrency must match EnvironmentFile"
    }
}

if (-not (Test-Path -LiteralPath $WorkerScript -PathType Leaf)) {
    throw "Quote worker entrypoint not found: $WorkerScript"
}
if ($Development) {
    Assert-PrecisionToolsNoReparsePoints -Path $WorkerScript
}
else {
    [void](Assert-PrecisionToolsTrustedSourceFile `
        -Path $WorkerScript `
        -SourceRoot $ProjectRoot `
        -Label "Precision Tools quote-worker source" `
        -DeploymentOperatorSid $DeploymentOperatorSid)
}
[void](Assert-PrecisionToolsPathContained `
    -Path $DataRoot `
    -Root $BackendRoot `
    -Label "Precision Tools quote-worker data directory")

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
Assert-PrecisionToolsNoReparsePoints -Path $DataRoot

try {
    try {
        $lockStream = [System.IO.File]::Open(
            $LockFile,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    }
    catch [System.IO.IOException] {
        Write-Host "Quote worker is already running for this project."
        exit 0
    }
    catch [System.UnauthorizedAccessException] {
        Write-Warning "The cross-session quote worker lock is owned by another account. A second worker will not be started."
        exit 0
    }

    if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
        $existingPidText = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
        $existingPid = 0
        if ([int]::TryParse($existingPidText, [ref]$existingPid) -and $existingPid -ne $PID) {
            $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
            if ($existingProcess -and $existingProcess.CommandLine -like "*run-quote-worker.ps1*") {
                Write-Warning "Quote worker PID $existingPid is still running without the current lock contract. A second worker will not be started."
                exit 0
            }
        }
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }

    [System.IO.File]::WriteAllText($PidFile, [string]$PID, $Utf8NoBom)

    $env:BACKEND_PYTHON = $BackendPython
    $env:OCC_PYTHON = $OccPython
    if ($Concurrency -gt 0) {
        $env:QUOTE_CAD_CONCURRENCY = [string]$Concurrency
    }
    elseif ([string]::IsNullOrWhiteSpace($env:QUOTE_CAD_CONCURRENCY)) {
        $env:QUOTE_CAD_CONCURRENCY = "2"
    }
    if ([string]::IsNullOrWhiteSpace($env:QUOTE_ASYNC_ARCHIVES_ENABLED)) {
        $env:QUOTE_ASYNC_ARCHIVES_ENABLED = "0"
    }

    Set-Location -LiteralPath $BackendRoot
    & $BackendPython -E -B -c "import flask, sqlalchemy"
    if ($LASTEXITCODE -ne 0) {
        throw "BACKEND_PYTHON cannot import the worker dependencies."
    }
    & $OccPython -E -B -c "from OCC.Core.BRep import BRep_Tool"
    if ($LASTEXITCODE -ne 0) {
        throw "OCC_PYTHON cannot import pythonocc-core."
    }

    $restartDelay = 1
    while ($true) {
        $startedAt = Get-Date
        Write-Host ("Starting quote worker with concurrency {0}." -f $env:QUOTE_CAD_CONCURRENCY)
        & $BackendPython -E -B $WorkerScript
        $exitCode = $LASTEXITCODE

        if ($NoRestart) {
            if ($exitCode -ne 0) {
                throw "Quote worker exited with code $exitCode."
            }
            break
        }

        $runtimeSeconds = ((Get-Date) - $startedAt).TotalSeconds
        if ($runtimeSeconds -ge 60) {
            $restartDelay = 1
        }
        Write-Warning "Quote worker exited with code $exitCode. Restarting in $restartDelay second(s)."
        Start-Sleep -Seconds $restartDelay
        $restartDelay = [Math]::Min($restartDelay * 2, 15)
    }
}
finally {
    if (Test-Path -LiteralPath $PidFile) {
        $pidText = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($pidText -eq [string]$PID) {
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }
    }
    if ($lockStream) {
        $lockStream.Dispose()
    }
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
}
