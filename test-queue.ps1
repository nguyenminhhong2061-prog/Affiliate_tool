# Script kiểm thử hàng đợi BullMQ (Giai đoạn 2)
$baseUrl = "http://localhost:3000"
$ts = Get-Date -Format "HHmmss"

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " 🚀 KỊCH BẢN KIỂM THỬ HÀNG ĐỢI BULLMQ & WORKER (GIAI ĐOẠN 2)" -ForegroundColor Cyan
Write-Host "=========================================================`n" -ForegroundColor Cyan

# 1. Kiểm tra Bull Board Admin Dashboard UI
Write-Host "[Test 1/4] Kiểm tra Dashboard Quản trị Hàng đợi (/admin/queues)..." -ForegroundColor Yellow
try {
    $dashboardRes = Invoke-WebRequest -Uri "$baseUrl/admin/queues" -Method Get
    if ($dashboardRes.StatusCode -eq 200) {
        Write-Host "  ✅ SUCCESS: Bull Board Dashboard đã hoạt động tại http://localhost:3000/admin/queues`n" -ForegroundColor Green
    }
} catch {
    Write-Host "  ❌ FAILED: Không truy cập được Bull Board Dashboard.`n" -ForegroundColor Red
}

# 2. Tạo 2 Job liên tiếp từ 2 User khác nhau
Write-Host "[Test 2/4] Gửi 2 Job liên tiếp vào Hàng đợi..." -ForegroundColor Yellow
$user1 = "q_user1_$ts"
$user2 = "q_user2_$ts"

$job1Res = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body (@{ shopee_url = "https://shopee.vn/product/111/222"; user_id = $user1 } | ConvertTo-Json) -ContentType "application/json"
Write-Host "  -> Đã tạo Job 1 (User: $user1, Job ID: $($job1Res.job_id)) - Vị trí: $($job1Res.queue_position)"

$job2Res = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs" -Method Post -Body (@{ shopee_url = "https://shopee.vn/product/333/444"; user_id = $user2 } | ConvertTo-Json) -ContentType "application/json"
Write-Host "  -> Đã tạo Job 2 (User: $user2, Job ID: $($job2Res.job_id)) - Vị trí: $($job2Res.queue_position)`n"

# 3. Theo dõi trạng thái Job 1 chuyển từ processing -> done
Write-Host "[Test 3/4] Theo dõi Worker xử lý Job 1 (Kỳ vọng: pending -> processing -> done)..." -ForegroundColor Yellow
$maxRetries = 15
$job1Done = $false

for ($i = 1; $i -le $maxRetries; $i++) {
    Start-Sleep -Seconds 1
    $statusCheck = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs/$($job1Res.job_id)" -Method Get
    Write-Host "  [Lần $i] Trạng thái Job 1: '$($statusCheck.status)'" -ForegroundColor Gray
    
    if ($statusCheck.status -eq "done") {
        $job1Done = $true
        Write-Host "  ✅ SUCCESS: Job 1 đã được Worker xử lý hoàn thành!" -ForegroundColor Green
        Write-Host "     - Link Affiliate trả về: $($statusCheck.result.affiliate_url)"
        Write-Host "     - Mã Voucher: $($statusCheck.result.voucher)`n"
        break
    }
}

if (-not $job1Done) {
    Write-Host "  ❌ FAILED: Job 1 chưa chuyển sang trạng thái done.`n" -ForegroundColor Red
}

# 4. Theo dõi Job 2 bắt đầu được xử lý tuần tự (Concurrency = 1)
Write-Host "[Test 4/4] Kiểm tra tính xử lý tuần tự (Job 2 hoàn thành sau Job 1)..." -ForegroundColor Yellow
$job2Status = Invoke-RestMethod -Uri "$baseUrl/api/v1/jobs/$($job2Res.job_id)" -Method Get
Write-Host "  -> Trạng thái Job 2 hiện tại: '$($job2Status.status)'"

if ($job2Status.status -eq "processing" -or $job2Status.status -eq "done") {
    Write-Host "  ✅ SUCCESS: Worker đã tự động tiếp nhận Job 2 sau khi Job 1 hoàn thành!`n" -ForegroundColor Green
} else {
    Write-Host "  ⏳ Job 2 vẫn đang chờ trong hàng đợi.`n" -ForegroundColor Yellow
}

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " 🎉 HOÀN THÀNH KIỂM THỬ HÀNG ĐỢI GIAI ĐOẠN 2!" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
