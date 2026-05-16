# Apply platform/SMTP vars from local .env to VPS and restart daiko-app
# Usage: npm run vps:apply-platform-env
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$deployFile = Join-Path $root ".env.deploy"

if (-not (Test-Path $envFile)) {
  Write-Host "Missing local .env: $envFile" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $deployFile)) {
  Write-Host "Missing .env.deploy (SSH settings)" -ForegroundColor Red
  exit 1
}

$keys = @(
  "DAIKO_PLATFORM_ADMIN_EMAILS",
  "DAIKO_INQUIRY_NOTIFY_TO",
  "DAIKO_SMTP_HOST",
  "DAIKO_SMTP_PORT",
  "DAIKO_SMTP_SECURE",
  "DAIKO_SMTP_USER",
  "DAIKO_SMTP_PASS",
  "DAIKO_SMTP_FROM"
)

function Read-EnvMap {
  param([string]$Path, [string[]]$FilterKeys)
  $map = @{}
  Get-Content $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0) { return }
    if ($line[0] -eq '#') { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $k = $line.Substring(0, $eq).Trim()
    $v = $line.Substring($eq + 1).Trim().Trim('"')
    if ($null -eq $FilterKeys -or ($FilterKeys -contains $k)) {
      $map[$k] = $v
    }
  }
  return $map
}

$parsed = Read-EnvMap -Path $envFile -FilterKeys $keys
$missing = @($keys | Where-Object { -not $parsed.ContainsKey($_) })
if ($missing.Count -gt 0) {
  Write-Host "Missing in .env: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}
if ([string]::IsNullOrWhiteSpace($parsed["DAIKO_SMTP_PASS"])) {
  Write-Host "DAIKO_SMTP_PASS is empty. Set it in local .env and retry." -ForegroundColor Red
  exit 1
}

$snippetLines = foreach ($k in $keys) {
  $val = $parsed[$k] -replace '"', '\"'
  "${k}=`"${val}`""
}
$snippetPath = Join-Path $PSScriptRoot ".vps-platform-env.snippet"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($snippetPath, [string[]]$snippetLines, $utf8NoBom)

$deployVars = Read-EnvMap -Path $deployFile -FilterKeys $null
foreach ($k in $deployVars.Keys) {
  [Environment]::SetEnvironmentVariable($k, $deployVars[$k], "Process")
}

$vpsHost = $env:DAIKO_VPS_HOST
$key = $env:DAIKO_VPS_KEY
$user = if ($env:DAIKO_VPS_USER) { $env:DAIKO_VPS_USER } else { "ubuntu" }
if (-not $vpsHost -or -not $key) {
  Write-Host "Set DAIKO_VPS_HOST and DAIKO_VPS_KEY in .env.deploy" -ForegroundColor Red
  exit 1
}

Write-Host "Applying platform env on $vpsHost ..." -ForegroundColor Cyan
& scp -i $key -o BatchMode=yes $snippetPath "${user}@${vpsHost}:~/daiko/scripts/.vps-platform-env.snippet"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$remoteCmd = @(
  "cd ~/daiko",
  "sed -i 's/\r$//' scripts/vps-update-platform-env.sh scripts/.vps-platform-env.snippet 2>/dev/null || true",
  "bash scripts/vps-update-platform-env.sh"
) -join "; "
& ssh -i $key -o BatchMode=yes "${user}@${vpsHost}" $remoteCmd
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done: VPS .env updated and daiko-app restarted." -ForegroundColor Green
