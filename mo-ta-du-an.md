# MÔ TẢ DỰ ÁN: Hệ thống tự động gắn sản phẩm Shopee vào YouTube Shopping

## 1. Tổng quan dự án

### 1.1. Mục tiêu
Xây dựng một mobile app cho phép người dùng dán link sản phẩm Shopee, hệ thống tự động gắn sản phẩm đó vào giỏ hàng/collection trên YouTube Studio (thông qua tài khoản YouTube đủ điều kiện tham gia chương trình affiliate), sau đó trả về cho người dùng link/mã voucher mới sinh ra từ quá trình gắn sản phẩm.

### 1.2. Ràng buộc thực tế quan trọng
- **Không có API chính thức** từ YouTube cho việc gắn sản phẩm vào Studio → bắt buộc dùng **browser automation** (Playwright) để giả lập thao tác người dùng thật.
- **Chỉ có 1 tài khoản YouTube** đủ điều kiện → mọi thao tác gắn sản phẩm phải xử lý **tuần tự** (hoặc song song rất hạn chế), tạo ra giới hạn throughput cứng cho toàn hệ thống.
- Hệ thống vận hành theo mô hình **hàng đợi bất đồng bộ**, không phải real-time — cần thiết kế UX và kỳ vọng người dùng phù hợp với điều này.
- Việc automation trên giao diện web của bên thứ ba tiềm ẩn rủi ro vi phạm điều khoản dịch vụ, có thể dẫn đến khóa/giới hạn tài khoản.

---

## 2. Các giai đoạn triển khai

### Giai đoạn 0 — Đo lường & chốt năng lực xử lý thực tế
**Việc làm:** Đo thời gian trung bình để hoàn tất 1 thao tác gắn sản phẩm thủ công trên Studio (mở product picker, nhập link, xác nhận, chờ mã trả về).

**Ý nghĩa:** Đây là bước nền tảng quyết định toàn bộ thiết kế phía sau. Vì chỉ có 1 tài khoản xử lý tuần tự, con số này (ví dụ 20-40 giây/sản phẩm) quyết định SLA thực tế của hệ thống (100 job có thể mất 30-60+ phút để xử lý hết). Nếu bỏ qua bước này, đội ngũ dễ thiết kế UX kỳ vọng sai (ví dụ hứa "xử lý ngay lập tức") dẫn đến trải nghiệm người dùng tệ khi tải cao.

---

### Giai đoạn 1 — Xây dựng Backend & Database
**Việc làm:** Xây API nhận link Shopee từ app, parse thông tin sản phẩm (qua Shopee Affiliate Open API), lưu job vào database với trạng thái ban đầu, trả về `job_id` ngay lập tức cho người dùng.

**Ý nghĩa:** Tách bạch giữa "tầng nhận yêu cầu" (rất nhẹ, xử lý được hàng nghìn request/giây) và "tầng xử lý thực tế" (bị giới hạn bởi automation). Nhờ tách bạch này, 100 người dùng gửi link cùng lúc sẽ không làm sập hệ thống ở tầng vào — bottleneck chỉ nằm ở tầng automation phía sau.

---

### Giai đoạn 2 — Thiết kế hàng đợi (Queue)
**Việc làm:** Dùng Redis + BullMQ (hoặc Celery + RabbitMQ) tạo hàng đợi `youtube-tagging`, cấu hình concurrency thấp (1-2), thêm rate limit và retry với backoff.

**Ý nghĩa:** Hàng đợi là lớp đệm giữa số lượng request đến (có thể tăng đột biến) và tốc độ xử lý cố định (giới hạn bởi 1 tài khoản YouTube). Đây cũng là nơi kiểm soát nhịp độ thao tác để tránh hành vi bất thường bị nền tảng phát hiện.

---

### Giai đoạn 3 — Worker Automation
**Việc làm:** Viết worker Playwright dùng session đã đăng nhập sẵn (`storageState`), thực hiện thao tác gắn sản phẩm trên Studio, scrape kết quả link/voucher trả về, cập nhật trạng thái job. Bổ sung circuit breaker (tự dừng khi lỗi liên tiếp) và cơ chế retry.

**Ý nghĩa:** Đây là phần lõi kỹ thuật của toàn hệ thống — nơi biến một thao tác thủ công trên giao diện web thành một quy trình tự động, ổn định và có khả năng phục hồi khi gặp lỗi (UI thay đổi, session hết hạn, mạng chậm...).

---

### Giai đoạn 4 — Xử lý tải cao & trải nghiệm hàng đợi
**Việc làm:** Hiển thị vị trí xếp hàng và thời gian chờ ước tính cho người dùng; giới hạn mỗi người chỉ có 1 job đang chờ tại một thời điểm; gửi push notification khi xử lý xong thay vì bắt người dùng chờ trong app.

**Ý nghĩa:** Vì tốc độ xử lý bị giới hạn cứng bởi 1 tài khoản, hệ thống không thể "nhanh hơn" bằng cách tối ưu code — chỉ có thể quản lý kỳ vọng người dùng tốt hơn. Đây là bước biến giới hạn kỹ thuật thành trải nghiệm chấp nhận được.

---

### Giai đoạn 5 — Giám sát & vận hành
**Việc làm:** Dashboard theo dõi số job chờ/đang xử lý/lỗi; health check session định kỳ; job test tự động hàng ngày để phát hiện sớm khi Studio đổi giao diện; cảnh báo tức thời khi có sự cố.

**Ý nghĩa:** Vì hệ thống phụ thuộc vào giao diện web bên thứ ba (có thể thay đổi bất cứ lúc nào mà không báo trước), giám sát chủ động là cách duy nhất để phát hiện sự cố trước khi nó ảnh hưởng hàng loạt người dùng, thay vì chờ người dùng phàn nàn.

---

### Giai đoạn 6 — Kế hoạch mở rộng
**Việc làm:** Khi nhu cầu vượt khả năng xử lý của 1 tài khoản, bổ sung thêm tài khoản YouTube đủ điều kiện (kênh riêng hoặc cộng tác viên), chia hàng đợi theo round-robin giữa các tài khoản.

**Ý nghĩa:** Đây là hướng duy nhất để tăng throughput thực sự (song song hóa), vì bản chất giới hạn nằm ở số lượng tài khoản có quyền thao tác, không nằm ở hạ tầng server.

---

## 3. Cấu trúc chung của hệ thống

```
┌─────────────────┐
│   Mobile App     │  (gửi link Shopee, xem trạng thái job, nhận thông báo)
└────────┬─────────┘
         │ POST /jobs
         ▼
┌─────────────────────────────┐
│   Backend API                │
│   - Parse link (Shopee API)  │
│   - Tạo job, lưu DB           │
│   - Trả job_id ngay lập tức   │
└────────┬─────────────────────┘
         │ đẩy job vào queue
         ▼
┌─────────────────────────────┐
│   Queue (Redis + BullMQ)     │
│   - Concurrency giới hạn     │
│   - Retry, backoff, rate limit│
└────────┬─────────────────────┘
         │ worker lấy job tuần tự
         ▼
┌─────────────────────────────┐
│   Worker Automation           │
│   (Playwright + session lưu   │
│   sẵn của 1 tài khoản YouTube)│
│   - Vào Studio → Shopping     │
│   - Gắn sản phẩm               │
│   - Scrape link/voucher        │
└────────┬─────────────────────┘
         │ cập nhật kết quả
         ▼
┌─────────────────────────────┐
│   Database                    │
│   - Trạng thái job             │
│   - Kết quả link/voucher       │
└────────┬─────────────────────┘
         │ push notification / polling
         ▼
┌─────────────────┐
│   Mobile App     │  (nhận kết quả)
└──────────────────┘

Song song: Dashboard giám sát + Health check + Cảnh báo
```

**Các thành phần chính:**
- **Mobile App**: Flutter hoặc React Native, giao diện nhập link, theo dõi hàng đợi, nhận push notification.
- **Backend API**: Node.js hoặc Go, xử lý nhẹ, không chứa logic automation.
- **Queue**: Redis + BullMQ, lớp đệm và điều tiết tốc độ xử lý.
- **Worker Automation**: Playwright chạy trong container riêng, xử lý tuần tự 1 tài khoản.
- **Database**: PostgreSQL, lưu job và trạng thái.
- **Hệ thống giám sát**: Dashboard (Bull Board hoặc tự xây), cảnh báo qua Telegram/Slack/email.

---

## 4. Những điều cần chú ý khi xây dựng hệ thống

### 4.1. Rủi ro nền tảng (quan trọng nhất)
- Automation trên giao diện web không phải API chính thức thường vi phạm điều khoản dịch vụ của nền tảng, có thể dẫn đến khóa tài khoản. Cần đánh giá kỹ mức độ rủi ro này trước khi mở rộng quy mô, và có phương án dự phòng (tài khoản thay thế, quy trình chuyển sang xử lý thủ công tạm thời).

### 4.2. Giới hạn throughput là giới hạn cứng
- Không thể "tối ưu code" để vượt qua giới hạn của 1 tài khoản. Toàn bộ kỳ vọng UX, SLA, thông báo cho người dùng phải được thiết kế dựa trên giới hạn này, không phải ngược lại.

### 4.3. Độ ổn định phụ thuộc giao diện bên thứ ba
- Bất kỳ thay đổi giao diện nào trên YouTube Studio đều có thể làm automation gãy ngay lập tức mà không có cảnh báo trước. Cần cơ chế kiểm thử tự động định kỳ và giám sát chủ động, không chỉ dựa vào báo lỗi từ người dùng.

### 4.4. Quản lý session cẩn trọng
- Không nên tự động hóa bước đăng nhập (dễ bị nền tảng đánh dấu bất thường/kích hoạt captcha). Đăng nhập thủ công, lưu session, và có quy trình gia hạn thủ công khi cần.

### 4.5. Nhịp độ thao tác tự nhiên
- Thêm độ trễ ngẫu nhiên giữa các thao tác automation, tránh nhịp độ đều đặn như máy móc, giảm khả năng bị phát hiện là hành vi bot.

### 4.6. Minh bạch với người dùng về thời gian chờ
- Vì hệ thống không real-time, cần truyền đạt rõ ràng thời gian chờ ước tính ngay từ giao diện, tránh gây cảm giác app bị lỗi hoặc treo.

### 4.7. Cơ chế phục hồi khi lỗi hàng loạt
- Circuit breaker để tự động dừng worker khi phát hiện nhiều lỗi liên tiếp (dấu hiệu session chết hoặc UI đổi), tránh để hàng chục job thất bại âm thầm mà không ai biết.

### 4.8. Vấn đề pháp lý và ủy quyền
- Nếu sau này mở rộng sang mô hình nhiều tài khoản/cộng tác viên, cần làm rõ vấn đề ủy quyền truy cập tài khoản, bảo mật thông tin đăng nhập, và trách nhiệm khi có sự cố liên quan đến tài khoản của bên thứ ba.

---

## 5. Lộ trình triển khai đề xuất

1. Xây API nhận job + database (nền tảng nhẹ, làm nhanh)
2. Dựng Redis + BullMQ, test với job giả lập
3. Đăng nhập thủ công, lưu session cho tài khoản YouTube
4. Ghép worker automation thật vào queue, test với số lượng nhỏ (5-10 job)
5. Bổ sung circuit breaker, retry, logging, chụp ảnh màn hình khi lỗi
6. Load test tầng API với 100 request đồng thời (không phải 100 automation thật)
7. Thêm UI hàng đợi và push notification cho app
8. Soft launch với số lượng người dùng nhỏ trước khi mở rộng quy mô
