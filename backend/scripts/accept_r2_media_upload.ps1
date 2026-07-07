param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [int]$OrderId,

    [string]$SalesToken = "",

    [string]$SalesEmail = "",

    [string]$SalesPassword = "",

    [Parameter(Mandatory = $true)]
    [string]$TestFile,

    [string]$FileStage = "packing",

    [string]$Caption = "R2 acceptance test",

    [string]$PythonExe = "D:\\anaconda\\python.exe",

    [switch]$RunMigration
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Checkpoint([string]$Message) {
    Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $Message)
}

function Assert-Condition([bool]$Condition, [string]$ErrorMessage) {
    if (-not $Condition) {
        throw $ErrorMessage
    }
}

if (-not (Test-Path -LiteralPath $TestFile)) {
    throw "TestFile not found: $TestFile"
}

$ext = [IO.Path]::GetExtension($TestFile).ToLowerInvariant()
$mimeByExt = @{
    ".mp4" = "video/mp4"
    ".webm" = "video/webm"
    ".mov" = "video/quicktime"
    ".jpg" = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".png" = "image/png"
    ".webp" = "image/webp"
    ".pdf" = "application/pdf"
}
$mimeType = $mimeByExt[$ext]
if (-not $mimeType) {
    throw "Unsupported extension $ext"
}

$fileInfo = Get-Item -LiteralPath $TestFile
$fileSize = [int]$fileInfo.Length

$headers = @{}

if (-not $SalesToken) {
    Assert-Condition (-not [string]::IsNullOrWhiteSpace($SalesEmail) -and -not [string]::IsNullOrWhiteSpace($SalesPassword)),
        "SalesToken is empty. Please provide -SalesToken or both -SalesEmail and -SalesPassword."

    $loginBody = @{
        email = $SalesEmail
        password = $SalesPassword
    } | ConvertTo-Json

    Write-Checkpoint "Login to get token..."
    $loginResp = Invoke-RestMethod -Method POST -Uri ($BaseUrl.TrimEnd("/") + "/api/portal/auth/login") -ContentType "application/json" -Body $loginBody
    Assert-Condition (-not $loginResp.error), "Login failed: $($loginResp.message)"
    $SalesToken = $loginResp.token
}

$headers.Authorization = "Bearer $SalesToken"
$headers["Content-Type"] = "application/json"

if ($RunMigration) {
    Write-Checkpoint "Run migration dry-run first..."
    & $PythonExe (Join-Path (Get-Location) "backend\scripts\migrate_portal_media_r2.py") --dry-run
    Write-Checkpoint "Run migration apply..."
    & $PythonExe (Join-Path (Get-Location) "backend\scripts\migrate_portal_media_r2.py")
}

Write-Checkpoint "Init R2 upload session..."
$initBody = @{
    filename = $fileInfo.Name
    mime_type = $mimeType
    file_size = $fileSize
    stage_key = $FileStage
    caption = $Caption
    visible_to_customer = $true
} | ConvertTo-Json

$initUri = $BaseUrl.TrimEnd("/") + "/api/portal/sales/orders/$OrderId/media/r2/init"
$initResp = Invoke-RestMethod -Method POST -Uri $initUri -Headers $headers -ContentType "application/json" -Body $initBody
Assert-Condition (-not $initResp.error), "r2/init failed: $($initResp.message)"
Write-Checkpoint "init ok; upload_id=$($initResp.upload_id)"

$uploadId = $initResp.upload_id
$uploadUrl = $initResp.upload_url

Write-Checkpoint "Upload file to R2 with PUT..."
$putResp = Invoke-WebRequest -Method PUT -Uri $uploadUrl -Headers @{"Content-Type" = $mimeType} -InFile $TestFile -UseBasicParsing
Assert-Condition ($putResp.StatusCode -ge 200 -and $putResp.StatusCode -lt 300), "R2 PUT failed status=$($putResp.StatusCode)"

$completeUri = $BaseUrl.TrimEnd("/") + "/api/portal/sales/orders/$OrderId/media/r2/complete"
$completeBody = @{ upload_id = $uploadId } | ConvertTo-Json
$completeReq = @{
    Method = "POST"
    Uri = $completeUri
    Headers = $headers
    ContentType = "application/json"
    Body = $completeBody
}

Write-Checkpoint "Complete upload..."
$complete1 = Invoke-RestMethod @completeReq
Assert-Condition (-not $complete1.error), "first complete failed: $($complete1.message)"
$mediaId = [int]$complete1.media_id
Write-Checkpoint "complete1 ok; media_id=$mediaId"

Write-Checkpoint "Repeat complete for idempotency check..."
$complete2 = Invoke-RestMethod @completeReq
Assert-Condition (-not $complete2.error), "second complete failed: $($complete2.message)"
Assert-Condition ([int]$complete2.media_id -eq $mediaId), "idempotency broken: media_id mismatch"
Write-Checkpoint "idempotency ok; media_id same"

Write-Checkpoint "Get ticket..."
$ticketUri = $BaseUrl.TrimEnd("/") + "/api/portal/orders/$OrderId/media/$mediaId/ticket"
$ticketResp = Invoke-RestMethod -Method POST -Uri $ticketUri -Headers $headers -ContentType "application/json" -Body (@{} | ConvertTo-Json)
Assert-Condition (-not $ticketResp.error), "ticket failed: $($ticketResp.message)"
$previewUrl = $ticketResp.url_path
if ($previewUrl -notmatch "^https?://") {
    $previewUrl = $BaseUrl.TrimEnd("/") + $previewUrl
}

Write-Checkpoint "Preview redirect check..."
$previewResp = Invoke-WebRequest -Method GET -Uri $previewUrl -MaximumRedirection 0
if ($previewResp.StatusCode -ne 302) {
    throw "preview did not redirect as expected, status=$($previewResp.StatusCode)"
}
if (-not $previewResp.Headers.Location) {
    throw "preview response missing Location header"
}
Write-Checkpoint "preview redirect ok; location head=$($previewResp.Headers.Location)"

Write-Checkpoint "Verify DB relation (media, pending)..."
$pyScript = @"
from database import SessionLocal
from models import PortalPendingUpload, PortalOrderMedia

order_id = int('$OrderId')
upload_id = '$uploadId'
media_id = int('$mediaId')

session = SessionLocal()
try:
    media = session.query(PortalOrderMedia).filter_by(id=media_id, order_id=order_id).first()
    if not media:
        print('CHECK_MEDIA=MISS')
        raise SystemExit(1)
    print('CHECK_MEDIA=OK')
    print(f'MEDIA_BACKEND={media.storage_backend}')
    print(f'MEDIA_KEY={media.storage_key}')

    pending = session.query(PortalPendingUpload).filter_by(upload_id=upload_id).order_by(PortalPendingUpload.id.desc()).first()
    if not pending:
        print('CHECK_PENDING=MISS')
        raise SystemExit(2)
    print('CHECK_PENDING=OK')
    print(f'PENDING_STATUS={pending.status}')
    print(f'PENDING_MEDIA_ID={pending.media_id}')
    print(f'PENDING_COMPLETED={pending.completed_at}')
finally:
    session.close()
"@

$tempPy = Join-Path $env:TEMP ("r2_accept_" + [guid]::NewGuid().ToString() + ".py")
$pyScript | Set-Content -Path $tempPy -Encoding UTF8
try {
    & $PythonExe $tempPy
} finally {
    Remove-Item -LiteralPath $tempPy -ErrorAction SilentlyContinue
}

Write-Checkpoint "Acceptance flow completed."

