# Script kiểm thử tự động toàn bộ API Giai đoạn 1 (hỗ trợ tạo user_id duy nhất cho mỗi lần chạy)
$baseUrl = "http://localhost:3000"
$ts = Get-Date -Format "HHmmss"
$userA = "user_A_$ts"
$userB = "user_B_$ts"
$userC = "user_C_$ts"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " 🚀 KỊCH BẢN KIỂM THỬ API - GIAI ĐOẠN 1" -ForegroundColor Cyan
Write-Host "=========================================`n" -ForegroundColor Cyan

# 1. Health Check
Write-Host "[Test 1/6] Kiểm tra Health Check (GET /health)..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    if ($health.status -eq "ok" -and $health.db -eq "ok" -and $health.redis -eq "ok") {
        Write-Host "  ✅ SUCCESS: Database & Redis đều hoạt động tốt.`n" -ForegroundColor Green
    } else {
        Write-Host "  ❌ FAILED: Health check không đạt.`n" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ FAILED: Không thể kết nối tới API server ($baseUrl). Server đã bật chưa?`n" -ForegroundColor Red
    exit 1
}

# 2. Tạo Job 1 (User A)
Write-Host "[Test 2/6] Tạo Job mới cho User A ($userA)..." -ForegroundColor Yellow
$bodyUserA = @{
    shopee_url = "https://shopee.vn/product/123456/789012"
    user_id = $userA
} | ConvertTo-Json

$jobA = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body $bodyUserA -ContentType "application/json"
Write-Host "  ✅ SUCCESS: Tạo Job A thành công!" -ForegroundColor Green
Write-Host "     - Job ID: $($jobA.job_id)"
Write-Host "     - Vị trí hàng đợi: $($jobA.queue_position)"
Write-Host "     - Thời gian chờ ước tính: $($jobA.estimated_wait_seconds)s ($($jobA.message))"
Write-Host "     - Tên sản phẩm (Mock): $($jobA.product.name)`n"

# 3. Thử tạo Job thứ 2 cho User A (Duplicate Check)
Write-Host "[Test 3/6] Thử tạo trùng Job cho User A (Kỳ vọng lỗi 409 Conflict)..." -ForegroundColor Yellow
try {
    $dup = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body $bodyUserA -ContentType "application/json"
    Write-Host "  ❌ FAILED: Hệ thống không chặn được job trùng.`n" -ForegroundColor Red
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 409) {
        Write-Host "  ✅ SUCCESS: Hệ thống đã chặn thành công! (HTTP 409 Conflict - Bạn đang có 1 job chưa hoàn thành)`n" -ForegroundColor Green
    } else {
        Write-Host "  ❌ FAILED: Trả về mã lỗi khác: $statusCode`n" -ForegroundColor Red
    }
}

# 4. Tạo Job cho User B (Kiểm tra vị trí hàng đợi)
Write-Host "[Test 4/6] Tạo Job mới cho User B ($userB)..." -ForegroundColor Yellow
$bodyUserB = @{
    shopee_url = "https://shopee.vn/product/999999/888888"
    user_id = $userB
} | ConvertTo-Json

$jobB = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body $bodyUserB -ContentType "application/json"
Write-Host "  ✅ SUCCESS: Tạo Job B thành công!" -ForegroundColor Green
Write-Host "     - Job ID: $($jobB.job_id)"
Write-Host "     - Vị trí hàng đợi: $($jobB.queue_position)"
Write-Host "     - Thời gian chờ ước tính: $($jobB.estimated_wait_seconds)s`n"

# 5. Tra cứu chi tiết Job A (GET /api/v1/jobs/:id)
Write-Host "[Test 5/6] Tra cứu chi tiết Job A (GET /api/v1/jobs/$($jobA.job_id))..." -ForegroundColor Yellow
$detailA = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs/$($jobA.job_id)" -Method Get
Write-Host "  ✅ SUCCESS: Lấy chi tiết Job A thành công!" -ForegroundColor Green
Write-Host "     - Trạng thái: $($detailA.status)"
Write-Host "     - Tên sản phẩm: $($detailA.product.name)"
Write-Host "     - Link gốc: $($detailA.product.original_url)`n"

# 6. Test Validate Link Shopee sai format
Write-Host "[Test 6/6] Gửi link không phải Shopee (Kỳ vọng lỗi 400 Bad Request)..." -ForegroundColor Yellow
$bodyInvalid = @{
    shopee_url = "https://google.com"
    user_id = $userC
} | ConvertTo-Json

try {
    $inv = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body $bodyInvalid -ContentType "application/json"
    Write-Host "  ❌ FAILED: Không chặn được link sai.`n" -ForegroundColor Red
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 400) {
        Write-Host "  ✅ SUCCESS: Đã chặn link không hợp lệ! (HTTP 400 Bad Request)`n" -ForegroundColor Green
    } else {
        Write-Host "  ❌ FAILED: Trả về mã lỗi khác: $statusCode`n" -ForegroundColor Red
    }
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " 🎉 HOÀN THÀNH TẤT CẢ KỊCH BẢN KIỂM THỬ!" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
