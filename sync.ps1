Set-Location $PSScriptRoot
Write-Host "Syncing..." -ForegroundColor Cyan
git pull origin main
Write-Host "Sync done!" -ForegroundColor Green
