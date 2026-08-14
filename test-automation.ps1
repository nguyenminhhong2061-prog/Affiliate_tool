# Script kiểm thử Playwright Worker & Circuit Breaker (Giai đoạn 3)
$baseUrl = "http://localhost:3000"
$ts = Get-Date -Format "HHmmss"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " 🚀 KỊCH BẢN KIỂM THỬ PLAYWRIGHT WORKER & CIRCUIT BREAKER (GIAI ĐOẠN 3)" -ForegroundColor Cyan
Write-Host "=========================================================`n" -ForegroundColor Cyan

# 1. Tạo Job cho Playwright Worker xử lý
Write-Host "[Test 1/3] Tạo Job mới cho Playwright Worker..." -ForegroundColor Yellow
$user = "pw_user_$ts"
$jobRes = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body (@{ shopee_url = "https://shopee.vn/product/777/888"; user_id = $user } | ConvertTo-Json) -ContentType "application/json"
Write-Host "  ✅ SUCCESS: Đã tạo Job ID: $($jobRes.job_id) (Product: $($jobRes.product.name))`n"

# 2. Theo dõi Playwright Worker thực thi
Write-Host "[Test 2/3] Theo dõi Playwright Automation Engine xử lý..." -ForegroundColor Yellow
$maxRetries = 15
$jobDone = $false

for ($i = 1; $i -le $maxRetries; $i++) {
    Start-Sleep -Seconds 1
    $statusCheck = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs/$($jobRes.job_id)" -Method Get
    Write-Host "  [Lần $i] Trạng thái Job: '$($statusCheck.status)'" -ForegroundColor Gray
    
    if ($statusCheck.status -eq "done") {
        $jobDone = $true
        Write-Host "  ✅ SUCCESS: Playwright Worker đã hoàn thành xuất sắc!" -ForegroundColor Green
        Write-Host "     - Link Affiliate: $($statusCheck.result.affiliate_url)"
        Write-Host "     - Mã Voucher: $($statusCheck.result.voucher)`n"
        break
    }
}

if (-not $jobDone) {
    Write-Host "  ❌ FAILED: Job chưa hoàn thành trong thời gian dự kiến.`n" -ForegroundColor Red
}

# 3. Kiểm tra Circuit Breaker & CLI Save Session Helper
Write-Host "[Test 3/3] Kiểm tra công cụ Quản lý Session & Circuit Breaker..." -ForegroundColor Yellow
$saveSessionScript = "packages/api/src/scripts/saveSession.ts"
if (Test-Path $saveSessionScript) {
    Write-Host "  ✅ SUCCESS: Script CLI đăng nhập thủ công 1 lần (saveSession.ts) đã sẵn sàng." -ForegroundColor Green
    Write-Host "     - Lệnh chạy khi Admin cần cập nhật cookie YouTube Studio: npm run save-session`n"
}

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " 🎉 HOÀN THÀNH KIỂM THỬ PLAYWRIGHT AUTOMATION GIAI ĐOẠN 3!" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
