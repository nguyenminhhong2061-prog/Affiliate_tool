# Kế hoạch: Tự động hóa YouTube Studio App bằng Appium

## Tổng quan

Vì tính năng "Tuyển tập" (Collections) chỉ tồn tại trong native app YouTube Studio trên Android, 
ta sẽ dùng **Appium + ADB** để điều khiển app thật trên điện thoại của người dùng.

## Kiến trúc hệ thống

```
[API Request: POST /api/v1/jobs]
         ↓
[BullMQ Worker]
         ↓
[Appium Driver] ←→ [ADB] ←→ [Điện thoại Android thật (USB/WiFi)]
         ↓
  [YouTube Studio App]
  - Kiếm tiền → Mua sắm → Tuyển tập
  - Chọn bộ sưu tập → Thêm sản phẩm
  - Dán link Shopee → Chọn Shopee → Chọn SP → Xong → Đăng
  - Vào lại Tuyển tập → ⋮ → Chia sẻ → Sao chép link
         ↓
  [Mở link bộ sưu tập bằng Playwright]
  - Tìm sản phẩm vừa gắn
  - Trích xuất link affiliate có voucher
         ↓
[Trả về link affiliate cho người dùng]
```

## Yêu cầu kỹ thuật

### Phía server (máy tính)
- Node.js + Appium 2.x (`npm install -g appium`)
- Appium UiAutomator2 driver (`appium driver install uiautomator2`)
- Android SDK / ADB tools
- Java JDK 11+

### Phía điện thoại
- Android 8+ (API 26+)
- Bật **Developer Options** + **USB Debugging**
- Cài sẵn app **YouTube Studio**
- Đã đăng nhập tài khoản kênh Tô Tiến Đạt
- Kết nối USB hoặc cùng WiFi với máy chủ

## Các bước cài đặt

### 1. Cài Appium Server
```bash
npm install -g appium
appium driver install uiautomator2
```

### 2. Cài Android SDK / Platform Tools
- Tải Android Studio hoặc chỉ Platform Tools
- Thêm `adb` vào PATH
- Kiểm tra: `adb devices`

### 3. Kết nối điện thoại
```bash
# Qua USB:
adb devices

# Qua WiFi (Android 11+):
adb pair <ip>:<port>    # Quét QR code trong Developer Options
adb connect <ip>:5555
```

### 4. Chạy Appium
```bash
appium --port 4723
```

## Kế hoạch code

### Các file cần tạo

#### [NEW] `packages/api/src/automation/appiumYoutubeStudio.ts`
- Class `AppiumYoutubeStudio`
- Method `addProductToCollection(shopeeUrl: string): Promise<string>`
  - Mở app YouTube Studio
  - Navigate: Kiếm tiền → Mua sắm → Tuyển tập
  - Chọn bộ sưu tập đầu tiên
  - Thêm sản phẩm: dán link Shopee
  - Chọn Shopee → chọn sản phẩm → Xong → Đăng
  - Lấy link chia sẻ bộ sưu tập

#### [NEW] `packages/api/src/scripts/testAppium.ts`  
- Script test để verify kết nối Appium hoạt động
- Chạy: `npm run test-appium`

#### [MODIFY] `packages/api/src/workers/jobWorker.ts`
- Tích hợp AppiumYoutubeStudio thay cho Playwright cho bước tagging

#### [NEW] `packages/api/src/scripts/checkAdb.ts`
- Kiểm tra ADB kết nối, in danh sách thiết bị
- Chạy: `npm run check-adb`

### Dependencies cần thêm
```json
{
  "webdriverio": "^8.x",
  "@wdio/appium-service": "^8.x"
}
```

## Luồng automation chi tiết (AppiumYoutubeStudio)

```
PHASE 1: GẮN SẢN PHẨM
─────────────────────
1. Khởi động Appium session với app YouTube Studio
2. Chờ app load → Màn hình chính
3. Tap "Kiếm tiền" ($) → chờ trang Kiếm tiền
4. Tap tab "Mua sắm" → chờ trang Mua sắm
5. Scroll tìm "Tuyển tập" → tap
6. Chọn bộ sưu tập đầu tiên có sẵn
7. Tap "Thêm sản phẩm"
8. Dán link Shopee vào ô tìm kiếm
9. Tap nút người bán "Shopee"
10. Chờ sản phẩm hiện → tap chọn sản phẩm
11. Tap nút "Xong"
12. Tap nút "Đăng" → chờ thành công

PHASE 2: LẤY LINK AFFILIATE
────────────────────────────
13. Quay lại Tuyển tập
14. Tap ⋮ (3-dots) trên bộ sưu tập vừa thêm SP
15. Tap "Chia sẻ"
16. Tap "Sao chép liên kết" → lấy URL từ clipboard
17. Mở URL bằng Playwright (web browser)
18. Tìm sản phẩm vừa gắn trong trang bộ sưu tập
19. Trích xuất link affiliate của sản phẩm
20. Trả về link cho người dùng
```

## Câu hỏi cần xác nhận

> [!IMPORTANT]
> **Bạn sẽ kết nối điện thoại với máy tính theo cách nào?**
> - USB Cable (đơn giản nhất, ổn định nhất)
> - WiFi/ADB over network (cần cùng mạng)
>
> **Điện thoại Android của bạn đang dùng version nào?**
> (Android 10, 11, 12, 13, 14?)
>
> **Đã bật Developer Options chưa?**
> (Cài đặt → Giới thiệu về điện thoại → Số bản dựng, tap 7 lần)

## Verification Plan

1. `npm run check-adb` → Xác nhận điện thoại kết nối thành công
2. `npm run test-appium` → Mở YouTube Studio app, chụp screenshot
3. `npm run test-mobile` → Chạy full flow gắn sản phẩm test
4. POST `/api/v1/jobs` → Verify pipeline hoàn chỉnh

