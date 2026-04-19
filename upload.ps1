Set-Location $PSScriptRoot
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git add .
$status = git status --porcelain
if ($status) {
    Write-Host "變更的檔案：" -ForegroundColor Cyan
    git status --short
    git commit -m "更新書籍管理系統 $timestamp"
    git push origin main
    Write-Host "上傳完成！" -ForegroundColor Green
} else {
    Write-Host "沒有任何變更需要上傳" -ForegroundColor Yellow
}
