param(
    [int]$ApiPort = 8100
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root "_local-runtime"
$OutLog = Join-Path $RuntimeDir "cloudflared-star.out.log"
$ErrLog = Join-Path $RuntimeDir "cloudflared-star.err.log"
$RuntimeConfig = Join-Path $Root "frontend\public\runtime-config.json"
$Cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$LocalApi = "http://127.0.0.1:$ApiPort"

function Assert-StarAfricaApi([string]$BaseUrl, [bool]$CheckCors = $false) {
    $origin = "https://mdanson27.github.io"
    $ready = $null
    $lastError = $null
    for ($attempt = 0; $attempt -lt 20 -and -not $ready; $attempt++) {
        try {
            $headers = if ($CheckCors) { @{ Origin = $origin } } else { @{} }
            $ready = Invoke-WebRequest "$BaseUrl/health/ready" -Headers $headers -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        }
        catch {
            $lastError = $_
            Start-Sleep -Seconds 1
        }
    }
    if (-not $ready) {
        throw "Star Africa readiness check never became reachable at $BaseUrl. Last error: $($lastError.Exception.Message)"
    }
    if ($ready.StatusCode -ne 200) {
        throw "Star Africa readiness check failed at $BaseUrl (HTTP $($ready.StatusCode))."
    }
    if ($CheckCors -and $ready.Headers['Access-Control-Allow-Origin'] -ne $origin) {
        throw "CORS validation failed at $BaseUrl/health/ready for origin $origin."
    }

    try {
        $verify = Invoke-WebRequest "$BaseUrl/api/v1/auth/session/verify" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        throw "Expected /api/v1/auth/session/verify to reject an anonymous request, but it returned HTTP $($verify.StatusCode)."
    }
    catch {
        if (-not $_.Exception.Response) { throw }
        $status = [int]$_.Exception.Response.StatusCode.value__
        if ($status -ne 401) {
            throw "Wrong service or wrong Star Africa build at $BaseUrl. /api/v1/auth/session/verify returned HTTP $status instead of 401."
        }
    }
}

if (-not (Test-Path $Cloudflared)) {
    throw "cloudflared was not found at $Cloudflared"
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Assert-StarAfricaApi $LocalApi

Remove-Item $OutLog, $ErrLog -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $Cloudflared -ArgumentList @(
    "tunnel", "--no-autoupdate", "--url", $LocalApi
) -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -PassThru

$publicUrl = $null
for ($attempt = 0; $attempt -lt 30 -and -not $publicUrl; $attempt++) {
    Start-Sleep -Seconds 1
    if (Test-Path $ErrLog) {
        $match = Select-String -Path $ErrLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
        if ($match) { $publicUrl = $match.Matches[0].Value }
    }
}

if (-not $publicUrl) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Cloudflare did not return a quick-tunnel URL. See $ErrLog"
}

Assert-StarAfricaApi $publicUrl $true

$preflightHeaders = @{
    Origin = "https://mdanson27.github.io"
    "Access-Control-Request-Method" = "GET"
    "Access-Control-Request-Headers" = "authorization"
}
$preflight = Invoke-WebRequest "$publicUrl/api/v1/auth/session/verify" -Method OPTIONS -Headers $preflightHeaders -UseBasicParsing -TimeoutSec 15
if ($preflight.StatusCode -ne 204 -or $preflight.Headers['Access-Control-Allow-Origin'] -ne "https://mdanson27.github.io") {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Star Africa tunnel failed browser CORS preflight validation."
}

$config = [ordered]@{
    updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    apiUrl = $publicUrl
}
$config | ConvertTo-Json | Set-Content -Path $RuntimeConfig -Encoding utf8

Write-Host "Star Africa tunnel validated successfully." -ForegroundColor Green
Write-Host "Tunnel: $publicUrl"
Write-Host "Origin: $LocalApi"
Write-Host "Runtime config updated: $RuntimeConfig"
Write-Host "Commit and deploy frontend/public/runtime-config.json so GitHub Pages uses this tunnel."
