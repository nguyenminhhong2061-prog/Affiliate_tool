# Hướng dẫn chạy dự án

> Mọi lệnh trong file này đã được chạy thử thật trên máy Windows của dự án.
> Kiến trúc và bối cảnh kỹ thuật xem `claude.md`; file này chỉ lo việc **chạy được**.

---

## 0. Hiểu trước khi gõ lệnh

Hệ thống có 5 mảnh, và **thứ tự khởi động không tuỳ tiện** — mảnh sau cần mảnh trước đã sẵn sàng:

```
1. Postgres + Redis   →  nơi lưu trạng thái job và kết quả tạm
2. Điện thoại Android →  nơi automation thao tác thật
3. Appium server      →  cầu nối giữa code và điện thoại
4. API + worker       →  nhận yêu cầu, đẩy hàng đợi, chạy automation
5. App mobile         →  giao diện người dùng (tuỳ chọn)
```

**Điều quan trọng nhất phải nhớ:** API và worker **bắt buộc chạy trực tiếp trên máy**, không chạy trong Docker. Container không với tới được điện thoại cắm USB. Container `affiliate_api` trong `docker-compose.yml` tồn tại nhưng **không dùng được** cho worker — đừng bật nó.

---

## 1. Hạ tầng — Postgres và Redis

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool
docker compose up -d postgres redis
docker compose ps
```

**Ý nghĩa:** Postgres giữ *trạng thái* job (pending / processing / done / failed). Redis giữ hai thứ khác nhau: hàng đợi BullMQ, và **link affiliate kèm hạn dùng**.

**Vì sao link không nằm trong Postgres:** link YouTube sinh ra có token ký thời gian, hết hạn sau ~45 phút. Lưu vĩnh viễn vào database sẽ khiến người dùng mở lại link cũ và gặp trang lỗi Shopee. Redis tự xoá khi hết TTL.

**Vì sao Postgres ở cổng 5433:** máy này đã có PostgreSQL cài sẵn chiếm 5432.

**Đạt yêu cầu khi:** cả hai container hiện `Up ... (healthy)`. Chữ `healthy` mới là đủ — `Up` thôi nghĩa là container sống nhưng dịch vụ bên trong có thể chưa nhận kết nối.

---

## 2. Điện thoại Android

Cắm cáp USB, rồi:

```cmd
"C:\platform-tools\platform-tools\adb.exe" devices
```

**Đạt yêu cầu khi** thấy dòng có chữ `device`:

```
rg4lijbinzlb657d        device
```

**Các trạng thái khác nghĩa là gì:**

| Hiện ra | Nghĩa | Cách xử lý |
|---|---|---|
| danh sách rỗng | máy chưa nhận | bật Gỡ lỗi USB trong Tuỳ chọn nhà phát triển; đổi chế độ USB sang **Truyền tệp (MTP)**, không để "Chỉ sạc" |
| `unauthorized` | máy thấy nhưng chưa cấp quyền | nhìn màn hình điện thoại, bấm Cho phép trong hộp thoại "Cho phép gỡ lỗi USB?" |
| `offline` | kết nối chập chờn | rút cắm lại cáp, hoặc `adb kill-server` rồi thử lại |

Kiểm tra kỹ hơn bằng script của dự án:

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool\packages\api
npm run check-adb
```

Script này báo thêm hãng máy, phiên bản Android, và **quan trọng nhất là app YouTube Studio đã cài chưa**.

**Màn hình điện thoại phải đang mở khoá.** Appium không thao tác được qua màn hình khoá.

---

## 3. Appium server

Mở **một cửa sổ cmd riêng** và để nó chạy suốt:

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool\packages\api
appium --port 4723
```

**Ý nghĩa:** Appium là tiến trình trung gian. Code gọi HTTP tới `127.0.0.1:4723`, Appium dịch thành lệnh UiAutomator2 gửi xuống điện thoại qua adb.

**Đạt yêu cầu khi** log hiện `Appium REST http interface listener started`. Kiểm tra từ cửa sổ khác:

```cmd
curl -s http://127.0.0.1:4723/status
```

**Cửa sổ này không được đóng.** Đóng là mọi job đang chạy đứt giữa chừng.

> **Nếu gặp lỗi `ERR_REQUIRE_ESM`** khi khởi động Appium: kiểm tra biến `NODE_OPTIONS`. Giá trị `--no-experimental-require-module` sẽ làm Appium 3.6 hỏng. Xoá biến đó rồi mở lại cửa sổ cmd.

---

## 4. API và worker

Mở **cửa sổ cmd thứ hai**:

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool\packages\api
npm run dev
```

**Ý nghĩa:** lệnh này khởi động *hai thứ trong một tiến trình* — máy chủ API Fastify (nhận yêu cầu từ người dùng) và worker BullMQ (lấy job ra chạy automation).

**Vì sao gộp chung:** worker cần gọi adb và Appium tới điện thoại, nên phải nằm trên máy thật chứ không trong container. Gộp vào một tiến trình cho đỡ phải quản lý hai cái.

**Worker chỉ chạy 1 job một lúc** (`concurrency: 1`). Đây không phải giới hạn kỹ thuật tuỳ chọn mà là ràng buộc cứng: chỉ có một điện thoại và một tài khoản YouTube.

**Đạt yêu cầu khi:**

```cmd
curl -s http://localhost:3000/health
```

trả về `{"status":"ok","db":"ok","redis":"ok",...}`.

`db` hoặc `redis` báo `error` nghĩa là bước 1 chưa xong — quay lại kiểm tra container.

**Xem hàng đợi bằng mắt:** mở trình duyệt vào `http://localhost:3000/admin/queues`.

---

## 5. Chạy thử

### 5.1. Thử automation mà KHÔNG đăng lên kênh (nên làm sau mỗi lần sửa code)

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool\packages\api
set DRY_RUN=1
set TEST_SHOPEE_URL=https://vn.shp.ee/xxxxxxxx
npm run test-mobile
```

**Ý nghĩa:** chạy trọn luồng — mở màn Mua sắm, chọn bộ sưu tập, thêm sản phẩm, chọn đúng món — rồi **dừng lại ngay trước nút "Đăng"**. Không có gì được xuất bản lên kênh.

**Đây là lưới an toàn quan trọng nhất của dự án.** Đã có lần automation gõ nhầm link vào ô Tiêu đề bộ sưu tập; nhờ dry-run mà thay đổi đó nằm trong sheet chưa lưu và bỏ đi được. Luôn chạy dry-run trước khi chạy thật sau mỗi lần sửa luồng.

**Kết thúc đúng** là dòng:

```
⏸  DRY RUN — dừng trước khi bấm "Đăng". Chưa có gì được xuất bản.
❌ Lỗi: [Automation Failed] [Dry run] Đã dừng trước bước "Đăng"
```

Chữ "Lỗi" ở đây **không phải hỏng** — dry-run cố tình kết thúc bằng lỗi để không ai nhầm nó với một job thành công.

**Sau khi dry-run xong**, màn hình điện thoại còn treo ở sheet chỉnh sửa với sản phẩm đã chọn nhưng chưa đăng. Không cần dọn tay: lần chạy sau tự `force-stop` app nên thay đổi chưa lưu bị bỏ. Muốn dọn ngay thì trên điện thoại bấm dấu **X** rồi chọn **"Loại bỏ"**.

### 5.2. Chạy job thật qua API

```cmd
curl -X POST http://localhost:3000/api/v1/jobs -H "Content-Type: application/json" -d "{\"shopee_url\":\"https://vn.shp.ee/xxxxxxxx\",\"user_id\":\"toi\"}"
```

Dấu nháy bên trong `-d` **bắt buộc** escape thành `\"` khi dùng cmd.

Chép `job_id` từ kết quả rồi theo dõi:

```cmd
set JOB=dan-job-id-vao-day
for /l %i in (1,1,30) do @(curl -s http://localhost:3000/api/v1/jobs/%JOB% & echo. & ping -n 11 127.0.0.1 >nul)
```

**Job xong khi** `"status":"done"` và có `affiliate_url`. Mất khoảng **110-130 giây**.

**Kiểm tra link có đúng sản phẩm không** mà không cần mở link: giải mã tham số `origin_link` bên trong `affiliate_url` — nó phải trỏ đúng sản phẩm bạn đã gửi. Đừng mở link affiliate chỉ để thử, vì mỗi lần mở ghi một lượt nhấp vào thống kê affiliate thật.

### 5.3. Thử giao diện mà không cần điện thoại

Dùng khi chỉ muốn kiểm tra app, không muốn đụng tới kênh YouTube.

**Tắt Appium trước** — đây là lưới an toàn: nếu biến môi trường không ăn, job sẽ hỏng vô hại vì không kết nối được Appium, thay vì chạy thật và gắn sản phẩm lên kênh.

Cửa sổ 1:

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool\packages\api
set AUTOMATION_MODE=simulation
npm run dev
```

Cửa sổ 2:

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool\packages\mobile
npx expo start --web --port 8081
```

Mở `http://localhost:8081`. Job xong trong ~4 giây và trả link giả dạng `affiliate_sim_xxxxxxxx`.

**Xác nhận đang ở chế độ giả lập:** tạo một job và xem nó có xong trong vài giây không. Link thật không bao giờ chứa chữ `affiliate_sim_`.

### 5.4. Chạy app mobile trên điện thoại thật

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool\packages\mobile
npm start
```

Quét mã QR bằng Expo Go. Ba điều kiện bắt buộc:

1. **`EXPO_PUBLIC_API_URL` trong `packages/mobile/.env` phải là IP LAN của máy chủ**, không phải `localhost` — trên điện thoại, `localhost` trỏ về chính điện thoại. Lấy IP bằng `ipconfig`. Sửa xong phải **reload hẳn app**, restart Metro không đủ.
2. **Mở cổng 3000 trên tường lửa.** Chạy trong PowerShell **quyền admin**:
   ```powershell
   New-NetFirewallRule -DisplayName "Affiliate API 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
   ```
   Thiếu bước này thì app báo không kết nối được — đây là nghi phạm số một.
3. **Không cài Expo Go lên chiếc điện thoại đang làm automation.** Appium đang điều khiển màn hình máy đó; hai bên sẽ tranh nhau. Cần máy thứ hai.

---

## 6. Tắt hệ thống

### 6.0. Kiểm tra trước khi tắt — bước này đừng bỏ

```cmd
docker exec affiliate_postgres psql -U affiliate_user -d affiliate_db -t -c "SELECT id, status FROM jobs WHERE status IN ('pending','processing');"
```

**Phải trả về rỗng.** Nếu còn dòng nào:

- Có job `processing` nghĩa là **worker đang điều khiển điện thoại ngay lúc này**. Tắt bây giờ sẽ cắt ngang giữa chừng, để lại dòng DB kẹt `processing` vĩnh viễn — và người dùng đó **bị khoá không gửi được job mới**, vì chốt chặn 1-job/user tính cả trạng thái này. Hệ thống **chưa có cơ chế tự cứu** (nợ kỹ thuật §7.5b trong `claude.md`), phải sửa tay trong database.
- Có job `pending` thì chờ nó chạy xong, hoặc chấp nhận nó nằm lại hàng đợi Redis và chạy tiếp ở lần bật sau.

Job thật mất khoảng 110-130 giây. Chờ hết là an toàn nhất.

### 6.1. Thứ tự tắt — ngược với thứ tự bật

Lý do phải ngược: mảnh dưới đang phục vụ mảnh trên. Tắt Redis khi worker còn sống thì worker ném lỗi kết nối; tắt Appium khi job đang chạy thì automation đứt giữa thao tác.

**Bước 1 — API + worker.** Bấm `Ctrl+C` ở cửa sổ đang chạy `npm run dev`, rồi **chờ vài giây cho nó tự dọn**. Nó không chết ngay mà lần lượt: đóng máy chủ Fastify → tắt worker OCR (tesseract) → ngắt kết nối Redis. Bấm `Ctrl+C` liên tục nhiều lần sẽ cắt ngang quá trình này và để lại tiến trình con.

**Bước 2 — Appium.** `Ctrl+C` ở cửa sổ `appium --port 4723`.

**Bước 3 — Metro / Expo** (nếu có chạy giao diện). `Ctrl+C` ở cửa sổ `npx expo start`.

**Bước 4 — Hạ tầng.**

```cmd
cd /d c:\Users\Admin\Desktop\Affiliate_tool
docker compose stop postgres redis
```

### 6.2. `stop` hay `down` — khác nhau quan trọng

| Lệnh | Container | Dữ liệu | Dùng khi |
|---|---|---|---|
| `docker compose stop` | dừng, vẫn còn | **giữ nguyên** | tắt hằng ngày — **dùng cái này** |
| `docker compose down` | xoá container | vẫn giữ (nằm trong volume) | cần dựng lại container sạch |
| `docker compose down -v` | xoá container | **XOÁ SẠCH** | ⚠️ mất toàn bộ lịch sử job và hàng đợi |

Tắt hằng ngày thì dùng `stop`. Lần bật sau chỉ cần `docker compose start postgres redis`, nhanh hơn `up`.

**Không bao giờ gõ `down -v`** trừ khi thực sự muốn xoá sạch database.

### 6.3. Điện thoại

Không cần rút cáp, không cần tắt Gỡ lỗi USB. Nếu muốn trả app về trạng thái sạch:

```cmd
"C:\platform-tools\platform-tools\adb.exe" shell am force-stop com.google.android.apps.youtube.creator
```

Lệnh này cũng **bỏ mọi thay đổi chưa lưu** đang treo trong app — ví dụ sheet chỉnh sửa còn mở sau một lượt dry-run.

### 6.4. Xác nhận đã tắt hết

```cmd
docker compose ps
curl -s http://localhost:3000/health
curl -s http://127.0.0.1:4723/status
```

Hai lệnh `curl` phải **báo lỗi không kết nối được** — đó mới là đã tắt.

Kiểm tra tiến trình node còn sót (PowerShell):

```powershell
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id, StartTime, @{n='RAM_MB';e={[math]::Round($_.WorkingSet64/1MB)}}
```

**Tiến trình nào chiếm vài trăm MB mà không thuộc cửa sổ nào đang mở là tiến trình treo.** Dừng bằng `Stop-Process -Id <PID> -Force`.

Chuyện này từng xảy ra thật: script `test-mobile` chạy xong việc nhưng không tự thoát, chiếm 345 MB. Đã sửa bằng cách cho script thoát tường minh, nhưng vẫn nên kiểm tra sau các phiên chạy dài.

---

## 7. Bốn cái bẫy hay mắc

### 7.1. `set` sống dai hơn bạn tưởng — nguy hiểm nhất

`set AUTOMATION_MODE=simulation` có hiệu lực với **toàn bộ cửa sổ cmd đó**. Chạy lại `npm run dev` trong chính cửa sổ ấy vẫn là chế độ giả lập, và bạn sẽ nhận link `affiliate_sim_...` giả mà tưởng thật.

Xoá bằng `set AUTOMATION_MODE=` (không có gì sau dấu bằng), hoặc chắc ăn hơn: **đóng cửa sổ, mở cái mới**. Y hệt với `DRY_RUN`.

### 7.2. Không có dấu cách quanh dấu `=`

`set JOB = abc` tạo biến tên `JOB ` (có dấu cách) với giá trị ` abc`. Lệnh sau sẽ không thấy biến.

### 7.3. Đổi ổ đĩa phải có `/d`

`cd c:\...` khi đang ở ổ D sẽ không nhảy sang ổ C. Luôn dùng `cd /d`.

### 7.4. Biến vòng lặp khác nhau giữa hai nơi

Gõ tay ở dấu nhắc thì `%i`; viết trong file `.cmd` thì `%%i`.

---

## 8. Khi có sự cố

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| `/health` trả `db: error` | container Postgres chưa `healthy`, hoặc sai cổng (phải là 5433) |
| Job kẹt `pending` mãi | worker chết, hoặc Redis mất kết nối — xem cửa sổ API |
| Job kẹt `processing` mãi | tiến trình chết hoặc điện thoại rớt USB giữa chừng. **Hiện chưa có cơ chế tự cứu** — phải sửa tay trong database, xem nợ kỹ thuật §7.5b của `claude.md` |
| `Không kết nối được Appium server` | cửa sổ Appium đã đóng, hoặc chạy sai cổng |
| App mobile báo không kết nối được | tường lửa chặn cổng 3000, hoặc `EXPO_PUBLIC_API_URL` đang trỏ `localhost` |
| Automation dừng giữa chừng kèm ảnh chụp | mở ảnh trong `packages/api/logs/screenshots/appium/` — thông báo lỗi luôn kèm đường dẫn ảnh và nội dung đọc được từ màn hình |

**Khi automation lỗi, luôn xem ảnh chụp trước khi đoán.** Mỗi bước thất bại đều lưu ảnh màn hình tại thời điểm hỏng kèm danh sách nhãn đọc được — nhìn ảnh mất 10 giây và thường thấy ngay vấn đề.

Muốn có thêm ảnh ở các mốc trên đường thành công (mặc định tắt để tiết kiệm ~8 giây mỗi job):

```cmd
set AUTOMATION_CHECKPOINT_SHOTS=1
```

---

## 9. Bảng lệnh tra nhanh

| Việc | Lệnh |
|---|---|
| Bật hạ tầng | `docker compose up -d postgres redis` |
| Kiểm tra thiết bị | `npm run check-adb` |
| Appium | `appium --port 4723` |
| API + worker | `npm run dev` |
| Kiểm tra API | `curl -s http://localhost:3000/health` |
| Xem hàng đợi | `http://localhost:3000/admin/queues` |
| Thử an toàn | `set DRY_RUN=1` rồi `npm run test-mobile` |
| Chỉ chạy Phase 2 | `npx ts-node src/scripts/testShareLink.ts` |
| Dump màn hình đang mở | `npx ts-node src/scripts/dumpCurrent.ts <tên>` |
| Chẩn đoán link affiliate | `npx ts-node src/scripts/testAffiliateLink.ts "<url>"` |
