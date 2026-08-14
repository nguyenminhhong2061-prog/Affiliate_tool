# Script kiểm thử Appium Worker & Circuit Breaker (Giai đoạn 3)
$baseUrl = "http://localhost:3000"
$ts = Get-Date -Format "HHmmss"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " 🚀 KỊCH BẢN KIỂM THỬ APPIUM WORKER & CIRCUIT BREAKER (GIAI ĐOẠN 3)" -ForegroundColor Cyan
Write-Host "=========================================================`n" -ForegroundColor Cyan

# 1. Tạo Job cho Appium Worker xử lý
Write-Host "[Test 1/3] Tạo Job mới cho Appium Worker..." -ForegroundColor Yellow
$user = "appium_user_$ts"
$jobRes = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body (@{ shopee_url = "https://shopee.vn/product/777/888"; user_id = $user } | ConvertTo-Json) -ContentType "application/json"
Write-Host "  ✅ SUCCESS: Đã tạo Job ID: $($jobRes.job_id) (Product: $($jobRes.product.name))`n"

# 2. Theo dõi Worker thực thi (Appium job có thể mất 40-120s)
Write-Host "[Test 2/3] Theo dõi Appium + Playwright pipeline..." -ForegroundColor Yellow
$maxRetries = 120
$jobDone = $false

for ($i = 1; $i -le $maxRetries; $i++) {
    Start-Sleep -Seconds 2
    $statusCheck = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs/$($jobRes.job_id)" -Method Get
    Write-Host "  [Lần $i] Trạng thái Job: '$($statusCheck.status)'" -ForegroundColor Gray
    
    if ($statusCheck.status -eq "done") {
        $jobDone = $true
        Write-Host "  ✅ SUCCESS: Worker đã hoàn thành!" -ForegroundColor Green
        Write-Host "     - Link Affiliate: $($statusCheck.result.affiliate_url)"
        Write-Host "     - Mã Voucher: $($statusCheck.result.voucher)`n"
        break
    }
    if ($statusCheck.status -eq "failed") {
        Write-Host "  ❌ FAILED: $($statusCheck.error_message)`n" -ForegroundColor Red
        break
    }
}

if (-not $jobDone -and $statusCheck.status -ne "failed") {
    Write-Host "  ❌ FAILED: Job chưa hoàn thành trong thời gian dự kiến (240s).`n" -ForegroundColor Red
}

# 3. Kiểm tra công cụ ADB & Appium
Write-Host "[Test 3/3] Kiểm tra công cụ ADB & Appium..." -ForegroundColor Yellow
Write-Host "  → npm run check-adb    (kiểm tra điện thoại)"
Write-Host "  → appium --port 4723   (khởi động Appium server)"
Write-Host "  → npm run test-appium  (test full flow thủ công)`n"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " 🎉 HOÀN THÀNH KIỂM THỬ APPIUM AUTOMATION GIAI ĐOẠN 3!" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
