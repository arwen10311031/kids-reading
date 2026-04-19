Set-Location $PSScriptRoot
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git add .
$status = git status --porcelain
if ($status) {
    git status --short
    git commit -m "update $timestamp"
    git push origin main
    Write-Host "Push done!" -ForegroundColor Green
} else {
    Write-Host "No changes." -ForegroundColor Yellow
}
