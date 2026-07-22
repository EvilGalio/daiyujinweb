[CmdletBinding()]
param(
    [string]$ProjectRoot = "",
    [string]$OccPython = (
        "C:\ProgramData\Daiyujin\Dependencies\occ\python.exe"
    ),
    [string]$RuntimeRoot = (
        "C:\ProgramData\Daiyujin\PrecisionTools\runtime"
    ),
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    ),
    [switch]$ValidateSecretsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Add-SidRule {
    param(
        [string]$Path,
        [Security.Principal.SecurityIdentifier]$Sid,
        [Security.AccessControl.FileSystemRights]$Rights,
        [Security.AccessControl.InheritanceFlags]$Inheritance = (
            [Security.AccessControl.InheritanceFlags]::None
        )
    )
    $acl = Get-Acl -LiteralPath $Path
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $Sid,
        $Rights,
        $Inheritance,
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-RuntimeDirectoryAcl {
    param(
        [string]$Path,
        [Security.Principal.SecurityIdentifier]$RuntimeSid
    )
    [void](New-Item -ItemType Directory -Path $Path -Force)
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = (
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $full = [Security.AccessControl.FileSystemRights]::FullControl
    $modify = [Security.AccessControl.FileSystemRights]::Modify
    $operator = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sidValue in @(
        "S-1-5-18",
        "S-1-5-32-544",
        $operator.Value
    ) | Select-Object -Unique) {
        $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
        $acl.AddAccessRule(
            [Security.AccessControl.FileSystemAccessRule]::new(
                $sid,
                $full,
                $inheritance,
                [Security.AccessControl.PropagationFlags]::None,
                $allow
            )
        )
    }
    $acl.AddAccessRule(
        [Security.AccessControl.FileSystemAccessRule]::new(
            $RuntimeSid,
            $modify,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            $allow
        )
    )
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Assert-ProtectedSecretsCsvAcl {
    param(
        [string]$Path,
        [Security.Principal.SecurityIdentifier]$OperatorSid
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Precision Tools operator secrets CSV was not found: $Path"
    }
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
        throw "Precision Tools operator secrets CSV ACL inheritance must be disabled"
    }
    $rules = $acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )
    $allowedSids = @(
        "S-1-5-18",
        "S-1-5-32-544",
        $OperatorSid.Value
    ) | Select-Object -Unique
    $observedRights = @{}
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne (
            [Security.AccessControl.AccessControlType]::Allow
        )) {
            throw "Precision Tools operator secrets CSV contains a deny access rule"
        }
        $sid = [string]$rule.IdentityReference.Value
        if ($sid -notin $allowedSids) {
            throw "Precision Tools operator secrets CSV grants access to an unexpected Windows principal"
        }
        $current = if ($observedRights.ContainsKey($sid)) {
            [int64]$observedRights[$sid]
        }
        else {
            [int64]0
        }
        $observedRights[$sid] = $current -bor [int64]$rule.FileSystemRights
    }
    $full = [int64][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($sid in @("S-1-5-18", "S-1-5-32-544")) {
        if (
            -not $observedRights.ContainsKey($sid) -or
            (([int64]$observedRights[$sid] -band $full) -ne $full)
        ) {
            throw "Precision Tools operator secrets CSV is missing protected FullControl"
        }
    }
    $operatorRights = [int64][Security.AccessControl.FileSystemRights]::Modify
    if (
        -not $observedRights.ContainsKey($OperatorSid.Value) -or
        (([int64]$observedRights[$OperatorSid.Value] -band $operatorRights) -ne `
            $operatorRights) -or
        (([int64]$observedRights[$OperatorSid.Value] -band (-bnot $operatorRights)) -ne 0)
    ) {
        throw "Precision Tools operator secrets CSV must grant only Modify to the current operator"
    }
}

if (-not (Test-Administrator)) {
    throw "Precision Tools runtime ACL configuration requires elevated PowerShell"
}
$operatorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
Assert-ProtectedSecretsCsvAcl -Path ([IO.Path]::GetFullPath($SecretsCsvPath)) `
    -OperatorSid $operatorSid
if ($ValidateSecretsOnly) {
    Write-Host "Precision Tools operator secrets CSV ACL: PASS"
    exit 0
}
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$backendRoot = Join-Path $root "backend"
$environment = Join-Path $backendRoot ".env"
$backendPython = Join-Path $root ".venv\Scripts\python.exe"
foreach ($path in @($backendRoot, $environment, $backendPython, $OccPython)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required Precision Tools runtime path was not found: $path"
    }
}

$runtimeSid = [Security.Principal.SecurityIdentifier]::new("S-1-5-19")
$readExecute = [Security.AccessControl.FileSystemRights]::ReadAndExecute
$inherit = (
    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
)
Add-SidRule -Path $root -Sid $runtimeSid -Rights $readExecute `
    -Inheritance $inherit
Add-SidRule -Path (Join-Path $root ".venv") -Sid $runtimeSid `
    -Rights $readExecute -Inheritance $inherit
Add-SidRule -Path (Split-Path -Parent $OccPython) -Sid $runtimeSid `
    -Rights $readExecute -Inheritance $inherit
Add-SidRule -Path $environment -Sid $runtimeSid `
    -Rights ([Security.AccessControl.FileSystemRights]::Read)

$runtimeDirectories = @(
    (Join-Path $backendRoot "data"),
    (Join-Path $backendRoot "uploads"),
    (Join-Path $backendRoot "static\thumbnails"),
    (Join-Path $backendRoot "static\stl"),
    (Join-Path $backendRoot "private\order_media"),
    (Join-Path $backendRoot "private\order_media\thumbs"),
    (Join-Path $RuntimeRoot "logs"),
    (Join-Path $RuntimeRoot "temp")
)
foreach ($directory in $runtimeDirectories) {
    Set-RuntimeDirectoryAcl -Path $directory -RuntimeSid $runtimeSid
}

Write-Host "Precision Tools LocalService runtime ACL: READY"
Write-Host "Runtime root: $RuntimeRoot"
