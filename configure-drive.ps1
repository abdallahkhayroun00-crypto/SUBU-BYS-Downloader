$ErrorActionPreference = 'Stop'
$manifest = Join-Path $PSScriptRoot 'manifest.json'
Write-Host ''
Write-Host 'SUBU BYS Downloader 2.0 - Google Drive OAuth setup' -ForegroundColor Cyan
Write-Host 'Paste the OAuth Client ID created for the Chrome Extension.'
Write-Host ''
$clientId = Read-Host 'OAuth Client ID'
$clientId = $clientId.Trim()
if (-not $clientId) {
  Write-Host 'No Client ID entered. Nothing changed.' -ForegroundColor Yellow
  exit 1
}
if (-not $clientId.EndsWith('.apps.googleusercontent.com')) {
  Write-Host 'Warning: this does not look like a Google OAuth Client ID.' -ForegroundColor Yellow
  $answer = Read-Host 'Continue anyway? (y/N)'
  if ($answer.ToLower() -ne 'y') { exit 1 }
}
$content = [System.IO.File]::ReadAllText($manifest)
$pattern = '("client_id"\s*:\s*")[^"]+("\s*,?)'
$replacement = '${1}' + $clientId + '${2}'
$updated = [regex]::Replace($content, $pattern, $replacement, 1)
if ($updated -eq $content) {
  Write-Host 'Could not find client_id in manifest.json.' -ForegroundColor Red
  exit 1
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifest, $updated, $utf8NoBom)
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host 'Now open chrome://extensions and click Reload on SUBU BYS Downloader.'
Write-Host 'Then click the extension icon -> Connect Drive.'
