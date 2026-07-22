[CmdletBinding()]
param(
    [ValidateSet("Daily", "Weekly", "Monthly")]
    [string]$Mode = "Daily",
    [string]$ProjectRoot = "",
    [string]$BackendPython = "",
    [string]$SevenZipPath = "",
    [string]$SecretsCsvPath = (
        "C:\ProgramData\Daiyujin\Operator\daiyujin-fresh-pc-secrets.csv"
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-CsvSecret {
    param([string]$Path, [string]$Key, [int]$MinimumLength = 32)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Protected secrets CSV was not found: $Path"
    }
    $matches = @(
        Import-Csv -LiteralPath $Path -Encoding UTF8 |
            Where-Object { [string]$_.key -ceq $Key }
    )
    if ($matches.Count -ne 1) {
        throw "Protected secrets CSV must contain exactly one $Key row"
    }
    $value = ([string]$matches[0].value).Trim()
    if ($value.Length -lt $MinimumLength -or $value -match "[\r\n]") {
        throw "Protected backup secret is missing or malformed"
    }
    return $value
}

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ([string]::IsNullOrWhiteSpace($BackendPython)) {
    $BackendPython = Join-Path $root ".venv\Scripts\python.exe"
}
if ([string]::IsNullOrWhiteSpace($SevenZipPath)) {
    $SevenZipPath = "C:\Program Files\7-Zip\7z.exe"
}
$backupScript = Join-Path $root "Backup-OrderPortal.ps1"
foreach ($path in @($BackendPython, $SevenZipPath, $backupScript, $SecretsCsvPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required Precision Tools backup input was not found: $path"
    }
}

$backupPassword = Get-CsvSecret -Path $SecretsCsvPath `
    -Key "PRECISION_TOOLS_BACKUP_PASSWORD"
[Environment]::SetEnvironmentVariable(
    "ORDER_PORTAL_BACKUP_PASSWORD",
    $backupPassword,
    [EnvironmentVariableTarget]::Process
)
try {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $backupScript `
        -Mode $Mode `
        -ProjectRoot $root `
        -PythonExe ([IO.Path]::GetFullPath($BackendPython)) `
        -SevenZipPath ([IO.Path]::GetFullPath($SevenZipPath))
    if ($LASTEXITCODE -ne 0) {
        throw "Precision Tools $Mode backup failed with exit code $LASTEXITCODE"
    }
}
finally {
    Remove-Item Env:ORDER_PORTAL_BACKUP_PASSWORD -ErrorAction SilentlyContinue
    $backupPassword = $null
}

Write-Host "Precision Tools protected $Mode backup: PASS"
