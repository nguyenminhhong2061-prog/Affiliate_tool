# DỰ ÁN: Hệ thống tự động gắn sản phẩm Shopee vào YouTube Shopping

> Cập nhật: 2026-08-19 (tối) — **đã bỏ HOÀN TOÀN việc dựng lại session trong vận hành thường**. Đo lô 5 job thật, 7 lượt chạy: `appium-tao-session` xuất hiện **0 lần** (lô trước: 2 lần / 23,3 s). Ba việc: phân loại lỗi (§4.14), nối lại session qua khởi động lại tiến trình (§4.15), và không xoá session lúc tắt. Job thành công **33,2 s trung bình** (lô trước 41,2 s, giảm 20%); job hỏng vì link giờ chỉ 16-31 s. Chi tiết §6 "Lô 5 job sau tối ưu session".
>
> Cập nhật: 2026-08-19 (tối) — **luật huỷ session Appium phân loại lại theo "lỗi nói về CÁI GÌ"** (§4.14). Trước đây mọi lỗi không phải lỗi đầu vào đều giết session, kể cả khi chỉ là một bước giao diện trượt — đo trên lô 5 job thật: **23,3 giây lãng phí**. Nay chỉ huỷ khi lỗi nói về session/thiết bị, kèm van an toàn từ lần thử ≥ 2. Kiểm chứng bằng tiêm lỗi có kiểm soát: lần 1 giữ → lần 2 `⚡ Dùng lại session` rồi van bật → lần 3 dựng mới.
>
> Cập nhật: 2026-08-19 — **Phase 3 chuyển từ Playwright sang HTTP `fetch` (0,2-0,4 s thay cho 3-11 s), nhưng bản đầu HỎNG 100%** và lọt qua vì phiên trước chỉ chạy `typecheck`, chưa chạy trên trang thật lần nào. RegEx cắt cụt mọi link ngay trước `origin_link` → không job nào trích được link, tất cả chờ 45 giây rồi báo một lỗi trỏ sai hướng. Đã sửa, đã đối chiếu với trình duyệt thật (3/3 link ở cả hai đường), đã chạy 3 job thật đầu-cuối (29-32 s, phase-3 **0,8-0,9 s**), và đã thêm hồi quy `checkCollectionExtractor.ts` — có kiểm tra là nó CÓ bắt lỗi. Chi tiết §4.13. Cùng đợt còn bắt được **lỗi bịa dữ liệu thứ NĂM** của dự án: trường `voucher` trả về chuỗi `URICOMPONENT` bóc từ mã JS của trang (§10.7 mục 5). Kèm: gỡ hẳn cờ `PLAYWRIGHT_PREWARM` (vô nghĩa khi không còn trình duyệt), và sửa `docker-compose.yml` để container `api` không tự bật lại chiếm cổng 3000 (§7.9).
>
> Cập nhật: 2026-08-17 (tối) — **đã đóng vòng lặp người dùng đầu-cuối qua giao diện web**: 5 job thật, 3 thành công ở **40,2 / 40,3 / 50,3 giây** tính từ lúc bấm nút (§5). Hai job hỏng lộ ra nợ kỹ thuật 7.5g: cầu chì đếm cả lỗi do link người dùng nên một link xấu làm hỏng job của người kế tiếp.
>
> Cập nhật: 2026-08-17 (tối) — nhóm A + sửa lỗi cuộn + B2: **48,1 s → 39,6 s** ở trạng thái ổn định. Toàn bộ hành trình đo thật: **128 → 68,9 → 61,3 → 51,6 → 48,1 → 42,0 → 40,2 → 39,6 s**. Hai điều đáng nhớ nhất: **dải thẻ bộ sưu tập nằm ngoài màn hình chứ không phải chưa render** (hiểu nhầm này khiến lever 2 đốt 6 giây vô ích mỗi job), và quy tắc **cắt được thành phần đo được ≠ cắt được tổng** — phần dư (app phản hồi) phình ra bù lại. Cả hai ở §8. Chi tiết ở §8 "Nhóm A". Kèm một sự cố thiết bị quan trọng ở §7.5f (MIUI tự tắt "Gỡ lỗi USB (Cài đặt bảo mật)" sau reboot, giết mọi session Appium).
>
> Cập nhật: 2026-08-17 (chiều) — đợt tối ưu 3 xong: **73,6 s → 51,6 s** ở trạng thái ổn định (≈63 s cho job đầu sau quãng nghỉ). Gồm prewarm (−8,6 s, bác bỏ kết luận "prewarm vô dụng" của đợt 2), `newCommandTimeout` 300→3600 s để tái dùng session thành hiện thực, và TẮT `humanDelay` theo quyết định của chủ dự án (`AUTOMATION_HUMAN_DELAY=1` để bật lại). Mục tiêu 25-30 s **không khả thi** với luồng hiện tại — ngân sách và ba tầng đường đi ở §8.
>
> Cập nhật: 2026-08-17 — job thành công bị báo `failed` và chạy lại 2 lần trên máy thật vì BullMQ mất lock, xem §4.9. Đã sửa cả gốc (`execSync` → `execFile`) lẫn ngọn (lock + chốt idempotent).
>
> Cập nhật: 2026-08-16 — đợt tối ưu tốc độ (128 s → 68,7 s) và hai lỗi nghiêm trọng phát hiện trong lúc kiểm chứng, xem §4.7 và §4.8.

---

## 1. Tổng quan

### 1.1. Mục tiêu

Người dùng dán link sản phẩm Shopee → hệ thống tự động gắn sản phẩm đó vào bộ sưu tập (Tuyển tập) trên YouTube Shopping thông qua tài khoản YouTube đủ điều kiện affiliate → trả về cho người dùng **link affiliate** của sản phẩm.

**Lưu ý quan trọng đã xác nhận thực tế:** kết quả trả về chỉ là **một link duy nhất**. Voucher/giảm giá được **nhúng sẵn trong link**, tự áp khi người dùng mở (Shopee hiển thị "Giảm đ… cho Người Theo Dõi"). Không tồn tại mã voucher dạng chuỗi riêng để trích xuất — đừng viết logic đi tìm mã, và tuyệt đối không sinh mã giả để lấp chỗ trống.

### 1.2. Ràng buộc thực tế

- **Không có API chính thức.** Tính năng gắn sản phẩm vào Tuyển tập **chỉ tồn tại trong app YouTube Studio trên Android** — không làm được trên web. Vì vậy bắt buộc dùng **Appium điều khiển app native**, không phải Playwright điều khiển trình duyệt như dự kiến ban đầu.
- **Mỗi job bắt buộc cần một "thiết bị Android"** đã đăng nhập tài khoản đủ điều kiện. Có thể là điện thoại thật (USB hoặc WiFi), máy ảo, hoặc Android cloud — nhưng không thể bỏ.
- **Chỉ có 1 tài khoản YouTube đủ điều kiện** → xử lý tuần tự → giới hạn throughput cứng. Thêm server/máy ảo **không** làm tăng công suất; chỉ thêm tài khoản mới tăng được.
- Hệ thống là **hàng đợi bất đồng bộ**, không real-time.
- Automation trên giao diện bên thứ ba tiềm ẩn rủi ro vi phạm điều khoản dịch vụ.

---

## 2. Kiến trúc thực tế (as built)

```
[Người dùng] ──POST /api/v1/jobs──> [API Fastify]
                                          │ tạo job, lưu DB, trả job_id ngay
                                          ▼
                                   [BullMQ + Redis]
                                   concurrency = 1, rate limit 3s
                                          │
                                          ▼
                                   [Worker Automation]
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                  [Appium + ADB]                    [HTTP fetch]
                  điều khiển app                    tải HTML trang bộ sưu tập
                  YouTube Studio                    trích link affiliate
                          │                               │
                  [Thiết bị Android]                      │
                          └───────────────┬───────────────┘
                                          ▼
                        [PostgreSQL] trạng thái job (KHÔNG chứa link)
                        [Redis TTL]  link affiliate, tự hết hạn
                                          │
                                          ▼
                        GET /api/v1/jobs/:id ──> [Người dùng]
```

**Vì sao link không lưu vào PostgreSQL:** link affiliate chứa token ký thời gian (`gads_t_sig`) và có hạn sử dụng. Lưu vĩnh viễn sẽ khiến người dùng mở lại link cũ và gặp trang lỗi Shopee. Link được giữ trong Redis kèm TTL (mặc định 45 phút, xem `RESULT_TTL_SECONDS`).

### Thành phần

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| API | Fastify + Zod | prefix `/api/v1` |
| Hàng đợi | BullMQ + Redis | concurrency 1 |
| Automation app | Appium 3.6 + UiAutomator2 8.4 | chạy trên host, cần ADB |
| Trích link | HTTP `fetch` + RegEx | đọc `ytInitialData` trong HTML trang bộ sưu tập. Trước 2026-08-19 là Playwright/Chromium — xem §4.13 |
| OCR | tesseract.js (tiếng Việt) | đọc chữ vẽ bằng canvas |
| Database | PostgreSQL 16 (Docker) | chỉ trạng thái job |
| Kết quả tạm | Redis (Docker) | link + TTL |
| Dashboard | Bull Board | `/admin/queues` |

---

## 3. Luồng automation chi tiết (đã kiểm chứng thật)

### PHASE 1 — Gắn sản phẩm (`AppiumYoutubeStudio.addProductToCollection`)

1. Deep link `studio.youtube.com/channel/<YT_CHANNEL_ID>/monetization/shopping` → vào thẳng màn **Mua sắm** (bỏ được 2 bước điều hướng dễ gãy)
2. Cuộn tìm dải thẻ bộ sưu tập → chọn theo tên (mặc định thẻ đầu tiên)
3. Tap thẻ → hiện **menu ngữ cảnh** (Chỉnh sửa / Chia sẻ / Xem số liệu / Xem trên YouTube / **Xoá**)
4. Chọn **"Chỉnh sửa"** → sheet chỉnh sửa bộ sưu tập
5. Tap **"Thêm"** → sheet "Thêm sản phẩm"
6. Dán link Shopee vào ô tìm kiếm → Enter
7. Mở bộ lọc **"Người bán"** → chọn **"Shopee"** *(bước bắt buộc — không lọc thì sản phẩm không hiện)*
8. Đọc tên sản phẩm bằng OCR, rồi tap nút **"+"** của sản phẩm khớp
9. Tap **"Xong"** → tap **"Đăng"**

### PHASE 2 — Lấy link affiliate

10. Quay lại màn Mua sắm → mở menu thẻ bộ sưu tập → **"Chia sẻ"** → **"Sao chép liên kết"**
11. Đọc clipboard qua **API clipboard của Appium** (không dùng `adb shell cmd clipboard get` — Android 16 đã bỏ lệnh này)
12. `fetch` tải HTML trang bộ sưu tập → RegEx bóc link Shopee trong `ytInitialData` → tìm sản phẩm **theo ID trong `origin_link`** → lấy link affiliate

**Bước 10-11 thường được BỎ QUA.** Link chia sẻ của một bộ sưu tập không đổi giữa các job (bằng chứng ở §8), nên nó được cache trong Redis và Phase 2 chỉ chạy khi cache trống hoặc link tỏ ra không dùng được. Tiết kiệm ~19 giây mỗi job.

**Bước 12 so khớp theo ID, không theo tên.** Link affiliate YouTube sinh ra mang tham số `origin_link` chứa URL sản phẩm gốc, giải mã ra được `sellerId/productId` — kiểm chứng thật: 7/7 link trên trang đều có. So theo ID là tuyệt đối; so theo tên từng trả **sai sản phẩm** cho người dùng, xem §4.8.

---

## 4. Phát hiện kỹ thuật quan trọng

Những điều dưới đây khiến automation "chạy nhưng không làm gì" — hoặc tệ hơn, "chạy và báo thành công trong khi làm sai" — rất khó chẩn đoán nếu không biết trước.

**Đọc §4.5 → §4.6 → §4.7 → §4.8 liền một mạch.** Bốn mục đó là bốn lần cùng một sai lầm tái diễn dưới hình dạng khác nhau: lớp bảo vệ có tồn tại nhưng chọn sai dấu hiệu, nên nó khẳng định thành công mà không chứng minh được gì.

### 4.1. App vẽ chữ bằng canvas — selector theo text vô dụng

Accessibility tree gần như trống:

| Màn hình | Tổng node | Node có nhãn |
|---|---|---|
| Tổng quan | 91 | 6 |
| Kiếm tiền | 90 | 4 |
| Mua sắm | 85 | 4 |

Mọi selector kiểu `text("Kiếm tiền")` **không bao giờ khớp**. Giải pháp: lớp `Screen` định vị 3 tầng — **accessibility → OCR → cấu trúc/toạ độ**.

Ngoại lệ đáng nhớ: **tên bộ sưu tập** ("24/04", "SP 6M-8M") *có* trong accessibility tree, nên chọn được theo tên.

### 4.2. Chuỗi tiếng Việt từ Android ở dạng Unicode NFD

Android trả `"Chọn sản phẩm"` dài **16 ký tự** (dấu tách rời), literal trong mã nguồn dài **13 ký tự** (dấu dựng sẵn). Hiển thị giống hệt nhau nhưng `===` trả `false`.

→ **Luôn dùng `normalizeText()` trong `uiFinder.ts`** (có `.normalize('NFC')`) cho mọi so khớp chuỗi lấy từ thiết bị. Lỗi này từng âm thầm vô hiệu hoá cả lớp chặn tap nhầm nút "Xoá".

### 4.3. Không được đoán sản phẩm

Màn kết quả xếp: `[sản phẩm khớp]` → mốc **"Các kết quả tương tự"** → `[gợi ý từ Lazada/sàn khác]`. Chỉ được chọn nút "+" nằm **phía trên** mốc đó. Nếu không khớp được tên sản phẩm, **báo lỗi thay vì lấy đại link đầu tiên** — trả nhầm sản phẩm cho người dùng tệ hơn là thất bại.

### 4.4. Không nuốt lỗi

Bản automation đầu tiên dùng try-catch bao quanh mọi thao tác, nên khi tap trượt nó vẫn chạy tiếp và báo "thành công" dù không làm gì. Nguyên tắc hiện tại: **mỗi bước thất bại đều ném lỗi kèm ảnh chụp + mô tả màn hình**, dừng pipeline ngay.

### 4.5. Tap thành công ≠ thao tác có hiệu lực

Bài học đắt nhất: cú tap vào nút **"+"** để chọn sản phẩm **chập chờn** — cùng toạ độ `y=846`, lần chạy này ăn, lần sau không. Nguyên nhân: danh sách kết quả vừa render xong chưa sẵn sàng nhận sự kiện chạm.

Hậu quả khi không kiểm tra: job vẫn bấm "Xong" → "Đăng" và **báo thành công dù không thêm được gì**, rồi thất bại mãi tận bước trích link với thông báo lạc hướng.

→ Với mọi thao tác **làm thay đổi dữ liệu**, phải xác minh kết quả rồi mới đi tiếp. Chưa đạt thì tap lại tối đa 3 lần, vẫn không được thì **dừng và báo lỗi**.

**Đừng bao giờ tin log "✅ thành công" mà không đối chiếu trạng thái thật.**

> ⚠️ **ĐÍNH CHÍNH 2026-08-16 — lớp bảo vệ mô tả ở mục này chưa từng chạy.**
>
> Bản ghi cũ nói dấu hiệu là "số node `Chọn sản phẩm` giảm đi một, hoặc xuất hiện nhãn `đã chọn`". Cả hai vế đều hỏng, xem §4.7. Vế thứ hai luôn đúng ngay từ đầu, nên `isProductSelected()` **luôn trả về true** và mọi dòng `✅ Xác nhận đã chọn sản phẩm` trong toàn bộ log cũ là khẳng định rỗng.
>
> Dấu hiệu đúng, đang dùng: **số nút mang nhãn CHÍNH XÁC `"Bỏ chọn sản phẩm"` tăng so với mốc chụp ngay trước khi tap.**

### 4.6. Dấu hiệu xác minh phải VẮNG MẶT trước khi thao tác

Ngày 2026-08-16, automation gõ link Shopee vào ô **Tiêu đề** của bộ sưu tập người dùng thay vì ô tìm kiếm. Ba khiếm khuyết độc lập chồng lên nhau, mỗi cái lẽ ra đã bị cái kia chặn:

1. **So khớp nhãn kiểu "chứa"** — `findNodeByLabel(['Thêm'])` trúng liên kết "Tìm hiểu **thêm**" nằm phía trên nút "＋ Thêm". Cả hai đều clickable, hàm lấy cái đầu tiên → tap trượt, sheet không mở.
2. **Dấu hiệu xác minh tự đánh lừa** — sau khi tap "Thêm", code chờ nhãn `"Thêm sản phẩm"`. Nhưng **chính nút vừa bấm mang nhãn đó** (`content-desc` của nút "＋ Thêm" đúng là "Thêm sản phẩm" — đã xác nhận bằng dump a11y, xem §8), nên `waitFor` khớp lại đúng cái nút cũ và báo thành công dù sheet chưa hề mở.
3. **Gõ vào "ô nhập đầu tiên"** — `typeIntoInput` lấy `EditText` đầu tiên trong cây; trên sheet chỉnh sửa đó là ô Tiêu đề.

→ **Quy tắc: dấu hiệu dùng để xác minh một thao tác phải là thứ KHÔNG tồn tại trước thao tác đó.** `Screen.tapUntilVisible` nay kiểm tra điều này và ném lỗi nếu dấu hiệu đã có sẵn, tap lại tối đa 3 lần rồi mới bỏ cuộc.

→ **Không bao giờ gõ vào "ô nhập đầu tiên".** `Screen.typeIntoLabeledInput` chỉ đích danh ô theo nhãn (`Tìm sản phẩm`), rồi xác minh ô đó **đang giữ con trỏ**; không có focus thì từ chối gõ.

→ `findNodeByLabel` nay ưu tiên khớp **chính xác** trước khớp chứa.

Điều đáng sợ nhất của vụ này: §4.5 đã dạy đúng bài học "tap thành công ≠ có hiệu lực", và bước này *đã có* lớp bảo vệ — nhưng lớp bảo vệ chọn sai dấu hiệu nên vô hiệu hoàn toàn. **Lớp bảo vệ chọn sai dấu hiệu nguy hiểm hơn không có lớp nào**, vì nó tạo cảm giác an toàn giả.

Cũng nhờ dry-run mà lỗi này không phá dữ liệu thật: thay đổi nằm trong sheet chưa lưu, đóng bằng "Loại bỏ" là xong. **Luôn chạy `DRY_RUN=1` trước khi chạy thật sau mỗi lần sửa luồng.**

### 4.7. Bốn nhãn lồng nhau — vì sao khớp "chứa" là cấm kỵ ở màn chọn sản phẩm

Màn kết quả tìm sản phẩm có đồng thời bốn nhãn trong cây a11y, và **cái nào cũng chứa cụm con của cái khác**:

```
"Chọn sản phẩm"          ← nút "+" cần bấm
"Bỏ chọn sản phẩm"       ← nút GỠ sản phẩm đã có trong bộ sưu tập
"Xem sản phẩm đã chọn"   ← nút xem danh sách
"Xoá người bán đã chọn"  ← nút xoá bộ lọc, xuất hiện NGAY khi lọc Shopee
```

Khớp kiểu `.includes()` gộp cả bốn làm một. Hậu quả là **ba lỗi độc lập cùng một gốc**:

1. **Tap nhầm vào nút gỡ.** Bộ lọc ứng viên dùng `.includes('chọn sản phẩm')`, mà `"Bỏ chọn sản phẩm"` chứa đúng cụm đó. Sản phẩm đã có trong bộ sưu tập mang nhãn gỡ → lọt vào danh sách ứng viên → cú tap trở thành **lệnh gỡ sản phẩm khỏi bộ sưu tập thật của người dùng**.
2. **Bộ đếm không bao giờ giảm.** `stillSelectable` đếm cũng bằng `.includes(...)`; nút sau khi chọn đổi từ `"Chọn sản phẩm"` thành `"Bỏ chọn sản phẩm"` — vẫn khớp. Số đếm đứng yên nên vế `stillSelectable < selectableBefore` **không bao giờ đúng**.
3. **Cả lớp xác minh là con dấu cao su.** Vế còn lại, `hasDeselect`, quét toàn màn hình tìm cụm `"đã chọn"`. Nhưng `"Xoá người bán đã chọn"` xuất hiện từ bước lọc Shopee, tức là **trước** khi tap. Vế này luôn đúng → hàm luôn trả về true.

Ba cái cộng lại tạo ra kịch bản tệ nhất: gửi lại một sản phẩm đã có → tap gỡ nó ra → xác minh báo thành công → bấm "Xong" → **"Đăng"** → bộ sưu tập được xuất bản với sản phẩm đã bị gỡ, mà người dùng nhận thông báo thành công.

→ **Đã sửa:** so khớp **chính xác** qua `hasExactLabel()`; thêm chốt chặn từ chối khi vùng kết quả đã có nút "Bỏ chọn sản phẩm"; dấu hiệu xác minh đổi thành "số nút Bỏ chọn tăng so với mốc trước khi tap".

→ **Kiểm chứng thật:** chạy lại đúng link vừa đăng, hệ thống từ chối tại **y=846** — đúng toạ độ mà bản cũ vẫn tap. Đó vừa là bằng chứng lỗi có thật, vừa là bằng chứng các hằng nhãn khớp đúng cây a11y của máy.

### 4.8. Trang công khai cập nhật CHẬM HƠN thao tác trong app

Ngày 2026-08-16, một job thật **trả link của sản phẩm khác** cho người dùng:

```
origin_link trong link đã trả : shopee.vn/product/1119655766/48362632627
đáng lẽ phải là               : shopee.vn/product/1615222441/42529174899
```

Chuỗi nhân quả:

1. Phase 1 gắn **đúng** sản phẩm và đã xác minh
2. Phase 3 mở trang bộ sưu tập chỉ thấy **6 link** thay vì 7 — trang công khai chưa cập nhật
3. So khớp theo `origin_link` **làm đúng**: không thấy ID → không khớp
4. **Đường lui so tên đè lên**, khớp 57% với một máy Samsung A17 LTE *khác* đã nằm sẵn trong bộ sưu tập, và trả link của nó

Hai bài học, bài thứ hai quan trọng hơn:

**a) Đường lui "so theo tên" nguy hiểm một cách có hệ thống.** Hai listing khác nhau của cùng một mẫu sản phẩm thừa sức vượt ngưỡng 0,5 của nhau. Không phải xui một lần — bất kỳ bộ sưu tập nào có hai sản phẩm cùng dòng đều dính.

→ **Đã sửa:** khi đã biết ID thì **chỉ** so theo ID, và **không còn đường lui nào theo tên**. Chưa thấy ID trên trang thì tải lại tối đa 45 giây; hết hạn vẫn không thấy thì **báo lỗi**. Tên sản phẩm giờ chỉ dùng khi không giải được ID từ link đầu vào, và cả khi đó cũng đòi hỏi ứng viên nhất phải cách ứng viên nhì ≥ 20 điểm.

**b) Tối ưu tốc độ có thể gỡ bỏ một lớp đệm vô tình.** Lỗi này nằm sẵn trong code từ trước nhưng chưa bao giờ nổ, vì Phase 2 tốn ~19 giây thao tác Appium — vừa đủ để YouTube kịp cập nhật trang. Cache link chia sẻ cắt đúng 19 giây đó và làm lỗi lộ ra ngay job đầu tiên.

→ **Khi cắt thời gian khỏi một pipeline, hãy hỏi thời gian đó có đang che giấu điều gì không.** Ở đây quãng chờ vô tình đang đóng vai một lớp đồng bộ mà không ai thiết kế ra nó.

Bài kiểm tra hồi quy thường trực: `npx ts-node src/scripts/checkWrongProductGuard.ts "<link bộ sưu tập>"` — dựng đúng kịch bản (ID vắng mặt + tên mồi nhử trùng sản phẩm thật) và khẳng định hệ thống từ chối. Chạy được **không cần điện thoại**.

### 4.9. Job THÀNH CÔNG bị báo `failed` và chạy lại trên máy thật — BullMQ mất lock

Ngày 2026-08-17, job `daca8661` gắn đúng sản phẩm, trích đúng link affiliate, ghi kết quả vào Redis — rồi **báo `failed` cho người dùng** và chạy lại 2 lần nữa trên điện thoại thật.

Chuỗi nhân quả:

1. `preflightCheck()` gọi 5 lệnh adb bằng `execSync`. Trên Android 16, `dumpsys window` + `dumpsys power` + `pm list packages` cộng lại **chặn cứng event loop 32 giây** — đo trực tiếp: Fastify không xử lý được request nào từ `08:13:22` tới `08:13:54`, dù client vẫn gửi đều mỗi 5 giây.
2. Lock của BullMQ mặc định **30 giây**, gia hạn bằng timer ở mốc 15 giây. Timer không chạy được trong lúc loop bị chặn → lock hết hạn ở giây thứ 30, tức là **trước khi** quãng chặn kết thúc.
3. Job vẫn chạy tiếp và **thành công trọn vẹn** (106,9 s), nhưng lúc ghi nhận kết quả thì `Missing lock ... moveToFinished` — BullMQ không nhận, vì worker đã mất quyền sở hữu job.
4. BullMQ coi job là *stalled* → đẩy chạy lại.
5. `clearCheckpoint()` đã chạy ở nhánh thành công, nên lần chạy lại **không thấy checkpoint** và lặp lại Phase 1 từ đầu.
6. Chốt §4.7 từ chối đúng (`hàng ở y=846 đang mang nút "Bỏ chọn sản phẩm"`) → lần 2, 3 thất bại → DB bị ghi đè thành `failed`, circuit breaker ngắt.

Kết cục người dùng thấy: `status: failed`, `result: null` — trong khi link affiliate **vẫn nằm nguyên trong Redis** và sản phẩm **đã lên bộ sưu tập**. Dòng DB tự mâu thuẫn và đó là dấu hiệu nhận biết nhanh nhất:

```
status = failed         ← ghi ở lần thử 3
completed_at = 01:15:08 ← ghi ở lần thử 1, lúc THÀNH CÔNG
```

**Điều kiện kích hoạt không ngẫu nhiên:** chỉ cần preflight vượt 30 giây. Hôm 16/08 nó chưa chạm ngưỡng nên lỗi nằm im — lại đúng mô-típ §10.7: dữ liệu/hành vi hỏng không gây triệu chứng cho tới khi có người chạm vào.

**Hai lớp bảo vệ đã cứu:** chốt §4.7 ngăn cú tap gỡ sản phẩm khỏi bộ sưu tập thật, và so khớp theo ID (§4.8) trả đúng link. Không có §4.7 thì hai lần chạy lại đó sẽ **gỡ sản phẩm ra rồi đăng lại bộ sưu tập thiếu**.

→ **Đã sửa, ba tầng:**

1. **Gốc** — `adb.ts`, `deviceHealth.ts`, `appiumYoutubeStudio.ts` chuyển hẳn sang `execFile` bất đồng bộ. Đây cũng là nợ kỹ thuật 7.5d cũ. Lệnh nhận **mảng tham số**, không phải chuỗi shell tự chèn dấu nháy; phần nào phải tới shell trên máy như một chuỗi liền (deep link `am start -d '<url>'`) thì gom vào một phần tử mảng.
2. **Ngọn** — `worker.ts` đặt tường minh `lockDuration: 300000`, `stalledInterval: 60000`, `maxStalledCount: 1`. Mặc định 30 giây quá sát với job 65-107 giây.
3. **Chốt idempotent** — đầu hàm xử lý, nếu `job:result:<id>` đã tồn tại thì trả luôn, **không đụng điện thoại**, và sửa DB về `done`. Tầng này chặn theo *kết quả* chứ không theo *nguyên nhân*, nên nó đỡ được cả những đường chạy lại khác: tiến trình chết đúng lúc, hay ai đó bấm retry trên Bull Board.

**Kiểm chứng thật (2026-08-17):**

- Đẩy lại đúng job `daca8661` vào hàng đợi → log chỉ có `⚠️ đã có kết quả trong Redis — bỏ qua, KHÔNG chạy lại automation`, **không một dòng `DeviceHealth`/`Appium`/`Automation` nào**. DB tự sửa về `done`, giữ nguyên `completed_at` cũ, API trả đúng link.
- Job thật `99af54bd` sau khi sửa: **không còn dòng `could not renew lock` hay `Missing lock` nào**, retry đúng chuẩn 3 lần rồi dừng.
- Job thật `49dcc48a` (sản phẩm Samsung A06 5G 4GB/64GB): **thành công trong 74,3 s, chạy đúng MỘT lần**, `phase-2 = 0,0 s`. Đây là ca kiểm chứng tốt cho §4.8 vì bộ sưu tập đã có sẵn một Samsung A06 5G của người bán khác (`65589552/26728758506`) — so khớp theo ID vẫn trả đúng `193124085/41450319080`.
- Độ trễ event loop **đo trực tiếp từng khâu** (`LagMeter` hẹn nhịp 100 ms, lệch bao nhiêu là loop bị chặn bấy nhiêu): `preflightCheck` **40 ms**, `remote()` tạo session **619 ms**, `saveScreenshot` 14 ms, `getPageSource` 15 ms, OCR 12-16 ms. Tức là sau khi sửa thì **không còn khâu nào chặn loop đáng kể**.

> ⚠️ **Cảnh báo phương pháp đo — tôi đã tự bẫy mình một lần ở đây.**
>
> Cách đo đầu tiên là "tìm khoảng trống giữa các dòng `incoming request` trong log". Nó cho ra "32 s trước khi sửa, 17,8 s sau khi sửa" và tôi đã kết luận nhầm rằng phần dư là do nạp module `webdriverio`.
>
> **Cả hai con số sau khi sửa đều là rác**: chúng chỉ phản ánh quãng tôi không gửi request nào — job được gửi ở một lệnh console, vòng poll bắt đầu ở lệnh kế tiếp, và khoảng trống giữa hai lệnh bị tính thành "loop bị chặn". Phép đo phụ thuộc vào việc client có đều tay hay không, nên nó **không đo được cái nó tưởng là đang đo**.
>
> Bằng chứng cho quãng chặn TRƯỚC khi sửa thì vẫn vững, nhưng nó đến từ chỗ khác: **lock của BullMQ thật sự hết hạn**. Timer gia hạn nằm trong tiến trình, không liên quan gì tới client — nó lỡ nhịp nghĩa là loop bị chặn thật. Đừng trích con số "32 s" như một phép đo; hãy trích sự kiện mất lock.
>
> Muốn đo độ trễ event loop thì đo **từ bên trong tiến trình** bằng một `setInterval` và so độ lệch. Đó là cách duy nhất ở đây cho ra số dùng được.

**Bài học chung với §4.5-§4.8:** lần này lớp bảo vệ không chọn sai dấu hiệu, mà là **không có tầng nào hỏi "việc này đã làm xong chưa?"** trước khi làm lại. Với thao tác đụng dữ liệu thật, câu hỏi đó phải được đặt ở đầu mỗi lần chạy, không phải chỉ ở nhánh retry đã biết trước.

### 4.11. "Sản phẩm đã có sẵn" KHÔNG phải lỗi — trả link của nó

Người dùng muốn **link**, còn việc sản phẩm đã nằm trong bộ sưu tập chỉ là chi tiết triển khai. Bản trước ném lỗi và bắt họ tự đi tìm link cũ.

Nay khi phát hiện hàng mang nút `"Bỏ chọn sản phẩm"`, Phase 1 **dừng tại chỗ** và pipeline đi thẳng sang Phase 3 để trích link của chính sản phẩm đó.

Ba điểm phải giữ đúng:

1. **Tuyệt đối không tap tiếp.** Hàng đó đang mang nút GỠ — bấm vào là xoá sản phẩm khỏi bộ sưu tập thật (§4.7).
2. **Không bấm "Xong"/"Đăng".** Bộ sưu tập không đổi thì đăng lại là thao tác thừa lên dữ liệu thật.
3. **Không ghi checkpoint.** Checkpoint nghĩa là "đã ĐĂNG thành công, đừng gắn lại" — ở đây chưa đăng gì. Ghi vào là nói dối trạng thái, và lần retry sẽ bỏ qua Phase 1 dựa trên tiền đề sai. Không ghi cũng không sao: lần chạy lại đi đúng đường này, lại phát hiện đã có, lại sang Phase 3 — kết quả giống hệt.

**Kiểm chứng thật** (job `0c8c349f`): **43,3 s**, trả đúng link của `1615222441/42529174899`, log có `⏭ Bỏ qua bước "Xong"/"Đăng" — bộ sưu tập không đổi`, và bộ sưu tập không xuất hiện bản sao nào.

### 4.12. HAI trạng thái rỗng của màn tìm sản phẩm — đều vẽ canvas

App có hai cách báo "không gắn được sản phẩm này", **cả hai đều vẽ bằng canvas** nên không có cách nào biết qua cây a11y. Dò thật 2026-08-17:

**Trạng thái A — ngoài chương trình liên kết** (link đúng định dạng, ID không tồn tại):

```
"Sản phẩm không có trong chương trình tiếp thị liên kết của YouTube Shopping"
```

Cái bẫy: ngay dưới banner app vẫn liệt kê `"Các kết quả tương tự"`, và chúng **cũng là hàng Shopee**, chỉ khác sản phẩm. Nên cây a11y trông **y hệt** trạng thái "tìm được hàng tương tự" — vẫn có `"Chọn sản phẩm"`, vẫn có `"Các kết quả tương tự"`.

**Trạng thái B — không có kết quả nào** (chuỗi tìm không khớp gì):

```
"Không tìm thấy kết quả nào"
"Thử nhập một cụm từ tìm kiếm khác hoặc tìm kiếm sản phẩm khác để thêm vào video của bạn"
```

Ở đây cây a11y chỉ còn 6 nhãn và **KHÔNG có `"Chọn sản phẩm"`** — nên vòng chờ cũ `waitFor(['Chọn sản phẩm'], 20-30s)` chắc chắn hết giờ rồi ném lỗi kỹ thuật vô nghĩa với người dùng.

→ **Đã xử lý bằng một cơ chế chung** (`waitForKetQuaTimKiem`): vòng chờ hỏi cây a11y như cũ, nhưng sau **4 giây ân hạn** mà vẫn chưa có kết quả thì chụp một tấm và OCR đúng **một lần** để xem app đã nói gì. Nhận ra banner nào thì ném `LoiDauVao` với câu tương ứng; không nhận ra thì chờ tiếp như cũ.

Ba lựa chọn thiết kế đáng giữ:
- **Ân hạn 4 giây** để không kết luận "rỗng" lúc app còn đang tải — lỗi ngược lại tệ hơn nhiều.
- **OCR đúng một lần**, vì banner rỗng khi đã hiện thì không tự biến mất, mà OCR tốn 1-2 giây.
- **OCR hỏng thì trả null**, tức chờ tiếp rồi báo lỗi chung — thà vậy còn hơn khẳng định sai một lý do cụ thể (§10.7).

→ **Ghép chuỗi trước khi so khớp:** app xuống dòng giữa câu (`…chương trình tiếp` / `thị liên kết của…`), nên tìm theo từng dòng OCR riêng lẻ sẽ trượt.

**Kiểm chứng thật:**
- Trạng thái A (job `0250201a`): hỏng sau **33,9 s**, `1/3 lần thử`, không đụng cầu chì
- Trạng thái B (dry-run): dừng ngay ở bước 5 thay vì chờ hết 20 giây, thông báo *"Sản phẩm này không nằm trong diện được nhận voucher — YouTube Shopping không tìm thấy nó."*

### 4.10. Xác minh bằng ĐÚNG phần tử mà bước sau sẽ dùng

§4.6 dạy rằng dấu hiệu xác minh phải VẮNG MẶT trước thao tác. Mục này thêm một điều kiện nữa, học được ngày 2026-08-17 từ một job hỏng thật:

```
[Automation] ❌ Job 71e87fea thất bại: [tap-dang] Không tìm thấy [Đăng]
```

Bước 8 bấm "Xong" và xác minh bằng nhãn `"Chỉnh sửa bộ sưu tập"` — hoàn toàn hợp lệ theo §4.6: nhãn đó vắng mặt trước, có mặt sau. Bước 9 ngay sau đó đi tìm nút `"Đăng"` và **không thấy**.

Lý do: hai nhãn cùng thuộc một sheet nhưng **không xuất hiện cùng lúc**. `"Chỉnh sửa bộ sưu tập"` là tiêu đề, hiện ngay khi sheet bắt đầu bung ra; `"Đăng"` là nút ở cuối, render sau. Xác minh bằng tiêu đề chỉ chứng minh *sheet đang mở ra*, không chứng minh *nút đã sẵn sàng để bấm*.

→ **Quy tắc: chờ đúng phần tử mà bước kế tiếp sẽ chạm vào, không chờ một dấu hiệu "tương đương về mặt logic".** Trên giao diện render dần, "tương đương về mặt logic" không có nghĩa là "sẵn sàng cùng lúc".

→ **Hệ quả về kỹ thuật:** chỉ truyền MỘT nhãn vào `waitFor` ở những chỗ như thế. `waitFor` trả về ở nhãn khớp đầu tiên, nên `['Đăng', 'Chỉnh sửa bộ sưu tập']` sẽ đưa đúng khe hở này quay lại.

**Vì sao lỗi này chỉ mới lộ ra:** `humanDelay` (0,9-1,8 giây) từng chèn vào đúng khe đó và che nó suốt nhiều tháng. Tắt humanDelay 2026-08-17 làm nó lộ ra. Đây là **đường hỏng có sẵn**, không phải do tắt humanDelay sinh ra — cùng mô-típ §4.8: *bỏ một quãng chờ làm lộ thứ mà nó đang vô tình che*. Đã sửa và kiểm chứng 3/3 job thật không còn lỗi.

### 4.13. `typecheck` sạch KHÔNG chứng minh gì về dữ liệu ngoài — Phase 3 hỏng hoàn toàn mà vẫn "xong"

Ngày 2026-08-19. Phiên trước chuyển Phase 3 từ Playwright sang `fetch` + RegEx, kết luận *"Mọi thay đổi đều đã qua kiểm định biên dịch (Typecheck). Tối ưu Phase 3 đã sẵn sàng."* — **bộ trích link chưa từng chạy trên một trang thật lần nào, và nó hỏng 100%.**

Lớp ký tự của RegEx loại trừ dấu `\`:

```
[^"'\\\s<>]+          ← dừng ngay khi gặp \
```

Nhưng URL trong `ytInitialData` được viết dưới dạng chuỗi JS, nên dấu `&` là `&`:

```
https://s.shopee.vn/an_redir?affiliate_id=17104820001&origin_link=https%3A%2F%2Fshopee.vn%2Fproduct%2F...
                                                     ↑ mọi link bị cắt cụt ở ĐÂY
```

Hậu quả xếp tầng, mỗi tầng che tầng dưới:

1. **Mất `origin_link`** → mất `sellerId/productId` → mất dấu hiệu so khớp DUY NHẤT (§4.8).
2. **6 link cụt thành CÙNG một chuỗi** → `new Set` gộp còn **1**. Trang 3 sản phẩm trông như chỉ có 1 link vô dụng.
3. **Thông báo lỗi trỏ sai hướng hoàn toàn**: *"Sản phẩm … không xuất hiện trên trang bộ sưu tập sau 45s chờ"* — đọc lên thì tưởng YouTube cập nhật chậm (§4.8), trong khi sản phẩm **có sẵn trên trang** ngay từ mili-giây đầu; chỉ là bộ trích không đọc nổi.

Mọi job đều tốn trọn 45 giây rồi hỏng, và không có gì trong log gợi đúng nguyên nhân.

**Vì sao không lớp nào bắt được:**

| Lớp | Vì sao trượt |
|---|---|
| `npm run typecheck` | Đây không phải lỗi kiểu. Kiểu của `string` không biết gì về nội dung nó chứa |
| `checkShopeeLinkMatching.ts` | Kiểm `extractOriginRef` trên chuỗi **tự dựng trong test** — hàm đó vẫn đúng, lỗi nằm ở bước lấy chuỗi từ HTML |
| `checkWrongProductGuard.ts` | Chỉ khẳng định hệ thống **TỪ CHỐI** khi không thấy ID. Khi bộ trích hỏng thì nó cũng từ chối → **test vẫn XANH** |

Tầng thứ ba đáng sợ nhất: một bài test âm tính **tự động qua** khi thành phần nó bao quanh hỏng hẳn. Đây chính là mô-típ §4.5-§4.7 lặp lại lần nữa — **lớp bảo vệ chọn sai dấu hiệu nguy hiểm hơn không có lớp nào.**

→ **Đã sửa:** lớp ký tự đổi thành `[^"'\s<>]+` (nuốt cả `\`, vì `"` mới là dấu kết thúc thật của chuỗi JSON), rồi `unescapeEmbeddedUrl()` gỡ escape sau. `{1,2}` xử lý cả hai tầng lồng (`&` lẫn `\\u0026`).

→ **Kiểm chứng bằng ĐỐI CHỨNG, không bằng "chạy thấy có kết quả":** đo cùng một trang qua hai đường độc lập.

```
trình duyệt thật (dumpCollectionLinks.ts) : 3 link, 3/3 mang ID   ← mốc chuẩn
fetch + RegEx, TRƯỚC khi sửa              : 1 link, 0/3 mang ID   ← hỏng
fetch + RegEx, SAU khi sửa                : 3 link, 3/3 mang ID   ← khớp mốc
```

Con số 3 chỉ có nghĩa khi đặt cạnh mốc 3 của trình duyệt. Nếu chỉ nhìn *"fetch trả về link, có vẻ chạy"* thì bản hỏng cũng "trả về link".

→ **Bài hồi quy thường trực mới:** `npx ts-node src/scripts/checkCollectionExtractor.ts "<link bộ sưu tập>"` — **không cần điện thoại**. Nó tự lấy mốc chuẩn TỪ CHÍNH TRANG (nên không lạc hậu khi bộ sưu tập đổi nội dung), rồi đòi mỗi sản phẩm phải trích ra đúng link của mình, cộng một ca âm tính có tên mồi nhử.

**Bài test này đã được kiểm tra là CÓ BẮT LỖI**: cố ý hoàn nguyên lớp ký tự về bản hỏng → 3/3 ca dương tính đỏ. Một bài hồi quy chưa từng thấy đỏ thì chưa chứng minh được nó bảo vệ điều gì.

→ **Tốc độ thì đúng như phiên trước kỳ vọng**, chỉ là chưa ai đo được vì luồng chưa chạy nổi: **0,2-0,4 s** mỗi lần trích, so với 3,0 s (trang ấm) / 11,3 s (trang nguội) của Playwright.

**Quy tắc rút ra — bổ sung cho §10.7:** khi đổi cách LẤY dữ liệu từ hệ thống ngoài, `typecheck` và test đơn vị đều không nói gì về việc dữ liệu có về đúng hay không. Phép kiểm duy nhất có giá trị là **chạy trên dữ liệu thật rồi đối chiếu với một đường lấy độc lập**. Không có đối chứng thì "chạy không lỗi" và "chạy đúng" nhìn giống hệt nhau.

### 4.14. Huỷ session phải hỏi "lỗi này nói về CÁI GÌ", không phải "có lỗi không"

Ngày 2026-08-19. §7.5g đã dạy một lần: phân loại lỗi theo **nó nói về cái gì**, chứ không theo nó có phải lỗi hay không. Lần đó là cho cầu chì. Cùng sai lầm còn nằm nguyên ở chỗ thứ hai — quyết định huỷ session Appium.

Luật cũ nhị phân: lỗi đầu vào thì giữ session, **mọi lỗi khác thì huỷ**. Nhưng "mọi lỗi khác" gộp hai thứ không liên quan gì nhau:

| | Ví dụ | Session còn dùng được? |
|---|---|---|
| **Kênh điều khiển hỏng** | session chết, adb rớt, UiAutomator2 sập, máy offline | ❌ phải dựng lại |
| **Một bước giao diện trượt** | tap không ăn, app render chậm, chờ quá hạn | ✅ vẫn khoẻ nguyên |

Loại thứ hai chiếm phần lớn thực tế. Đo trên lô 5 job thật:

```
L3: [cho-ket-qua-tim-kiem-tho] Chờ 20s vẫn không thấy kết quả tìm kiếm.
L5: [mo-them-san-pham] Không tìm thấy [Thêm].
```

Cả hai là lỗi giao diện thuần — thiết bị khoẻ, session khoẻ, adb khoẻ. Vậy mà cả hai đều giết session, bắt job kế tiếp trả **12,1 s** (L4) và **11,2 s** (L6): **23,3 giây lãng phí trong một lô 5 job**, vì một lý do không nói gì về sức khoẻ của session.

**Vì sao giữ session vẫn an toàn với §4.6** — đây là mấu chốt, và nó là chính lý lẽ mà code đã dùng sẵn cho lỗi đầu vào: **trạng thái sạch của APP không đến từ session, nó đến từ `force-stop`.** `init()` luôn force-stop ở đầu mỗi job, trừ khi đọc cây a11y và XÁC MINH DƯƠNG TÍNH là đang ở màn Mua sắm sạch. Giữ lại kênh điều khiển không hề làm mất đảm bảo "bắt đầu từ trạng thái biết chắc". Chốt sống/chết cũng còn nguyên: `init()` gọi `getWindowSize()` trước khi tái dùng.

→ **Đã sửa:** `errors.ts` thêm `laLoiHongKenhDieuKhien()` (danh sách dấu hiệu ĐÓNG) và `coNenHuySession(err, lanThu)` trả về cả quyết định lẫn **lý do để log** — khi một job sau đó chậm vì phải dựng session, dòng log đó là thứ cho biết tại sao.

→ **Danh sách dấu hiệu cố ý ĐÓNG, không bắt rộng.** Bắt sót một lỗi hạ tầng chỉ khiến lần thử sau tốn thêm chút thời gian rồi van an toàn dọn nốt; bắt nhầm một lỗi giao diện thì quay lại đúng chỗ lãng phí 11 giây mà bản sửa này sinh ra để bỏ.

→ **Van an toàn:** từ lần thử **thứ hai** trở đi thì huỷ bất kể lỗi gì. Lần đầu ta đặt cược "session vẫn tốt"; chạy lại vẫn hỏng thì tiền đề đó đáng nghi, và 11 giây là giá rẻ để loại trừ một biến. Van này chặn đúng kịch bản xấu nhất: **một session hỏng âm thầm nhưng vẫn trả lời `getWindowSize()`** — thứ mà chốt sống/chết không bắt được.

→ **Ngữ nghĩa `attemptsMade` đã kiểm bằng mã nguồn, không đoán:** `bullmq/dist/cjs/classes/job.js` tăng nó trong `moveToCompleted`/`moveToFailed`, tức **sau** khi lượt chạy kết thúc. Nên trong lúc xử lý nó là số lần thử TRƯỚC đó, và `lanThu = attemptsMade + 1` cho ra 1, 2, 3.

**Hồi quy thường trực:** `npx ts-node src/scripts/checkSessionDisposal.ts` — **không cần điện thoại**. Dùng ĐÚNG NGUYÊN VĂN thông báo lỗi quan sát được trong lô thật, không phải chuỗi tự nghĩ ra: một bài test dựng bằng chuỗi tưởng tượng chỉ chứng minh hàm khớp được chuỗi tưởng tượng ấy. Đã kiểm bộ khung có báo đỏ được (cố tình làm sai → 5 ca hỏng, exit 1).

### 4.15. Session Appium sống sót qua khởi động lại tiến trình — và vì sao "dọn dẹp lúc tắt" là đánh đổi sai

Ngày 2026-08-19. Sau khi §4.14 xử lý xong nhóm "huỷ oan vì lỗi giao diện", nguyên nhân dựng lại session còn sót lớn nhất là thứ chẳng ai coi là lỗi: **tiến trình API khởi động lại**.

`sharedDriver` nằm trong RAM. Tiến trình chết là mất — dù session vẫn sống nguyên trên Appium server và điện thoại vẫn sẵn sàng. Job đầu tiên sau đó trả **11-14 giây** dựng lại một thứ đang tồn tại, còn session cũ nằm mồ côi tới khi hết `newCommandTimeout`. Điều này xảy ra ở **mọi** lần `ts-node-dev` nạp lại khi sửa file, mọi lần crash, mọi lần triển khai.

Tệ hơn: `shutdown()` **chủ động xoá** session, với chú thích cũ nói đó là dọn dẹp đúng đắn. Nghe hợp lý, nhưng nó đánh đổi sai — trả 11-14 giây ở mỗi lần khởi động lại để đổi lấy việc không để một session nằm chờ trên một thiết bị **chuyên dụng cho đúng hệ thống này**.

→ **Đã sửa, hai phần:**

1. **`services/appiumSessionStore.ts`** — lưu `sessionId` + `capabilities` vào Redis (TTL 3000s, dưới `newCommandTimeout` 3600s một biên 10 phút). `init()` gọi `attach()` của webdriverio để nối lại thay vì tạo mới.

2. **`shutdown()` không xoá nữa, chỉ nhả tham chiếu** (`nhaSessionGiuTrenServer`). Đặt `APPIUM_DISPOSE_ON_EXIT=1` để quay về hành vi cũ khi cần trả thiết bị cho việc khác.

→ **Bản ghi Redis chỉ là GỢI Ý, không phải nguồn sự thật.** Nó đi qua đúng chốt `getWindowSize()` như đường tái dùng thường; sai hoặc cũ thì xoá rồi dựng mới như cũ. Trường hợp xấu nhất là mất thêm một vòng gọi mạng — đo thật từ log wdio: nó thử lại 3 lần trong **~1,5 giây** trước khi bỏ cuộc. Trạng thái APP vẫn do `force-stop` đảm bảo, nối lại session không đụng tới §4.6.

→ **Kiểm chứng thật:** giết tiến trình API, khởi động lại, log lần đầu hiện

```
⚡ Nối lại session của tiến trình trước (bỏ ~11-14s dựng mới)
[Appium] ⚡ Đã hâm nóng session — job đầu tiên không phải chờ dựng.
```

**Bài học chung với §4.14:** hai lần liên tiếp, nguyên nhân dựng lại session hoá ra là một hành vi *cố ý* mà ai đó viết ra vì nó trông giống việc đúng đắn — "hỏng thì dọn cho sạch", "tắt thì đóng cho gọn". Cả hai đều bỏ qua cùng một sự thật: **trạng thái sạch của app đến từ `force-stop`, không đến từ việc vứt session đi.** Chỗ nào thấy code chủ động huỷ session, hãy hỏi nó đang bảo vệ điều gì — thường là điều đã được bảo vệ ở chỗ khác rồi.

### 4.16. Kẹt ở sheet chỉnh sửa, không bấm được "＋ Thêm" — §4.10 lặp lại, và một lớp retry chưa từng chạy

Người dùng báo 2026-08-19: sheet chỉnh sửa bộ sưu tập mở ra bình thường rồi **đứng luôn ở đó**, không sang bước thêm sản phẩm, phải chờ rất lâu hoặc chạy lại.

```
[Automation] ❌ [mo-them-san-pham] Không tìm thấy [Thêm].
```

**Thông báo lỗi tự mâu thuẫn với bằng chứng của chính nó.** Ngay dưới dòng đó, phần `Nội dung đọc được` mà trình xử lý lỗi dump ra lại CÓ nhãn cần tìm:

```
a11y=[Chỉnh sửa bộ sưu tập | Đóng | … | Thêm sản phẩm | … | Đăng]
ocr =[… | Sản phẩm -L- Thêm | …]
```

Nút có thật, nằm đúng chỗ. Nó chỉ **chưa có vào đúng mili-giây mà `find()` hỏi** — và đã kịp có vào lúc dump ảnh lỗi vài trăm mili-giây sau.

#### Khiếm khuyết 1 — xác minh bằng dấu hiệu của bước TRƯỚC (đúng mô-típ §4.10)

Bước `[3/9]` xác minh sheet đã mở bằng nhãn `"Chỉnh sửa bộ sưu tập"` — đó là **tiêu đề** sheet, hiện ngay khi sheet bắt đầu bung ra. Bước `[4/9]` ngay sau đó đi tìm nút `"＋ Thêm"`, vốn nằm **DƯỚI danh sách sản phẩm** của bộ sưu tập nên render sau.

Đây chính xác là §4.10, chỉ khác nút: lần đó là `"Đăng"` sau khi bấm `"Xong"`, lần này là `"＋ Thêm"` sau khi mở sheet chỉnh sửa. **Cùng một bài học, và nó đã tái diễn dù đã được ghi lại:** trên giao diện render dần, *"tương đương về mặt logic" không có nghĩa là "sẵn sàng cùng lúc"*.

**Vì sao mãi tới hôm nay mới nổ:** bộ sưu tập tăng từ **3 lên 6 sản phẩm**. Danh sách dài hơn thì phần dưới sheet render muộn hơn, khe hở rộng ra đủ để lọt. Đường hỏng có sẵn từ trước; thứ thay đổi là *dữ liệu*, không phải code. Cùng họ với §10.7: **hỏng nằm im cho tới khi có điều kiện chạm vào nó.**

→ **Đã sửa:** chờ đúng nhãn `"Thêm sản phẩm"` (chính là `content-desc` của nút, xác nhận ở §4.6) xuất hiện trong cây a11y trước khi tap. Dùng `seenWithin` nên **không ném lỗi khi hết giờ** — hết 10 giây vẫn đi tiếp và để `tapUntilVisible` xử lý như cũ. Thêm một đường hỏng mới ở đây sẽ tệ hơn chính lỗi đang sửa.

→ Đồng thời đổi nhãn tìm thành `['Thêm sản phẩm', 'Thêm']`: nhãn dài khớp **chính xác** với `content-desc` thật nên không thể trúng liên kết mồi `"Tìm hiểu thêm"` (§4.6); `"Thêm"` giữ lại vì OCR đọc nút đó ra chữ ngắn.

#### Khiếm khuyết 2 — lớp retry của `tapUntilVisible` chưa từng chạy cho kiểu hỏng này

Đây mới là phần đáng sợ. `tapUntilVisible` có vòng `for (i = 1; i <= 3; i++)`, và mọi lời gọi trong luồng đều tin rằng nó thử lại 3 lần. Nhưng lần thử **đầu tiên** để `this.tap()` nằm NGOÀI `try/catch`, còn các lần sau thì trong:

```ts
if (i === 1) {
  tapped = await this.tapRemembered(...);
  if (!tapped) tapped = await this.tap(...);   // ← ném thẳng ra ngoài hàm
} else {
  try { tapped = await this.tap(...); } catch { /* ghi log rồi thử tiếp */ }
}
```

Hệ quả: vòng lặp chỉ bảo vệ được MỘT trong hai kiểu hỏng — *"tap rồi mà không ăn"*. Kiểu còn lại — *"chưa thấy nút để mà tap"* — thoát ngay ở lần 1, thành job hỏng, rồi BullMQ chạy lại **cả job ~30 giây** cho một thứ mà 600 mili-giây chờ thêm là đủ.

→ **Đã sửa:** lần thử đầu chịu được lỗi định vị y như các lần sau, kèm nghỉ 600 ms giữa các lượt. Không vi phạm §4.4 "không nuốt lỗi": lỗi vẫn được ghi và vẫn ném ra nếu hết cả 3 lần — nó chỉ không còn cắt ngang chính cơ chế sinh ra để xử lý nó.

#### Kiểm chứng

- **Khiếm khuyết 1:** 4/4 job thật liên tiếp qua bước này sạch, **0 cảnh báo**, 26,2 / 26,9 / 29,2 / 31,7 s.
- **Khiếm khuyết 2:** tiêm lỗi định vị có kiểm soát vào đúng lần thử đầu. Log cho:

  ```
  ⚠ [mo-them-san-pham] lần 1/3: chưa tap được (… Không tìm thấy …)
  [5/9] Dán link Shopee: …
  ```

  Job **vẫn chạy tiếp và thành công** (38,4 s). Bản cũ sẽ hỏng ngay tại đây. Code tiêm lỗi đã gỡ sạch.

**Quy tắc rút ra:** khi một thông báo lỗi nói "không tìm thấy X" mà ảnh/dump kèm theo lại CÓ X, đừng đi tìm lỗi so khớp nhãn — hãy nghi **thời điểm hỏi**. Và mỗi khi thấy một vòng retry, hãy kiểm xem lần lặp đầu tiên có đi qua đúng đường như các lần sau không; ngoại lệ ở lần đầu là chỗ lớp bảo vệ âm thầm biến mất.

---

## 5. Tiến độ

| Giai đoạn | Trạng thái | Chi tiết |
|---|---|---|
| **0 — Đo năng lực xử lý** | ✅ | **~40 s/job** ở trạng thái ổn định (2026-08-17, sau nhóm A + B2). Lô 9 job liên tiếp đo trước đó: 52,5 s/job, thông lượng 56,3 s/job (~64 job/giờ). Trước tối ưu: 128-132 s |
| **1 — Backend & Database** | ✅ | API, Zod validation, queue position, chống job trùng |
| **2 — Hàng đợi** | ✅ | BullMQ concurrency 1, retry 3 lần, backoff |
| **3 — Worker Automation** | ✅ | **Đã chạy thật đầu-cuối**: gắn sản phẩm → đăng → lấy link → trích affiliate. Người dùng xác nhận mở link và áp voucher thành công |
| **4 — Trải nghiệm hàng đợi** | 🟡 | Có `queue_position`, `estimated_wait_seconds`, giới hạn 1 job/user. **Chưa có push notification** |
| **5 — Giám sát** | 🟡 | Có `/health`, Bull Board, circuit breaker, chụp ảnh khi lỗi. **Chưa có cảnh báo, chưa có job test định kỳ** |
| **6 — Mở rộng nhiều tài khoản** | ❌ | Chưa bắt đầu |
| **Giao diện người dùng** | ✅ (web) / 🟡 (mobile) | App Expo (SDK 57) ở `packages/mobile`: 1 ô nhập + nút "Lấy link" + hiện link. **Bản web đã chạy JOB THẬT đầu-cuối** 2026-08-17: 5 job qua giao diện, 3 thành công (40,2 / 40,3 / 50,3 s), 2 hỏng có nguyên nhân xác định (§5). **Chưa chạy trên điện thoại thật** — thiếu máy thứ hai vì máy hiện có đang bị Appium chiếm |

### Đã kiểm chứng đầu-cuối

- ✅ Automation thật trên điện thoại thật (Xiaomi, Android 16) — sản phẩm được đăng thật, link affiliate hoạt động, người dùng xác nhận áp voucher thành công
- ✅ **Job thật chạy trọn vẹn qua API** (2026-08-15): `POST /api/v1/jobs` → BullMQ → worker → điện thoại thật → Redis TTL → `GET /jobs/:id` trả link affiliate hợp lệ. Thời gian thật: **128 giây**
- ✅ Checkpoint chống gắn trùng đã kiểm chứng trong thực tế: một job lỗi ở bước cuối, BullMQ retry 3 lần → Phase 2 chạy 3 lần nhưng Phase 1 chỉ chạy 1 lần
- ✅ **Chạy lại đầu-cuối sau khi sửa lỗi §4.6** (2026-08-16, job `d64483bb`): dry-run xác nhận chọn đúng sản phẩm → job thật qua API xong trong **132 giây** → link affiliate trả về có `origin_link` giải mã ra đúng `shopee.vn/product/1274547388/28130046415`, trùng sản phẩm của link rút gọn đầu vào. Đây là cách xác minh đúng sản phẩm mà **không cần mở link** (mở sẽ ghi một lượt nhấp giả vào thống kê affiliate thật)
- ✅ **Hai job thật sau đợt tối ưu** (2026-08-16): job `6d8931e0` **101,1 s** (cache nguội) → job `209dd49b` **68,7 s** (cache link chia sẻ trúng, `phase-2 = 0,0 s`). Cả hai gắn đúng sản phẩm; job thứ hai lộ ra lỗi §4.8 ở bước trả link và đã được sửa
- ✅ **Tái dùng session Appium** kiểm chứng bằng log job thứ hai: `⚡ Dùng lại session Appium đang có`
- ✅ **Link chia sẻ bộ sưu tập không đổi**: hai lần "Sao chép liên kết" cách nhau vài phút cho cùng đường dẫn, chỉ khác tham số theo dõi `si`
- ✅ **Job thật 2026-08-17** (`daca8661`, sản phẩm Honor X6c): Phase 1 + Phase 3 chạy đúng trong **106,9 s** với `phase-2 = 0,0 s` (cache link chia sẻ trúng). Nhưng job bị báo `failed` vì lỗi mất lock — xem §4.9. Trừ session nguội thì phần việc thật là **65,0 s**; với session 11-14 s như đo lại thì job thành công ở trạng thái ổn định **≈ 77 s**, còn **≈ 65 s** khi tái dùng session
- ✅ **Chốt idempotent và lock đã kiểm chứng** 2026-08-17 bằng hai job thật, xem §4.9
- ✅ **5 job thật qua GIAO DIỆN WEB** (2026-08-17, lái bằng Playwright trên `localhost:8081`): 3 thành công **40,2 / 40,3 / 50,3 s** tính từ lúc bấm nút tới lúc link hiện ra. Giao diện hiển thị đúng chuỗi trạng thái *"Đang chờ tới lượt…"* → *"Đang gắn sản phẩm vào YouTube…"* → link + nút Sao chép + giờ hết hạn, không lỗi JS. Đây là lần đầu đóng vòng lặp **người dùng → giao diện → API → điện thoại → link**

  Hai job hỏng và nguyên nhân, cả hai đều KHÔNG phải lỗi giao diện:
  - Job 1: sản phẩm đã nằm trong bộ sưu tập (do chính job thử nghiệm chạy trước đó thêm vào) → chốt §4.7 chặn đúng, 3 lần thử hết 120,8 s
  - Job 2: **hỏng dây chuyền** — 3 lần thất bại của job 1 làm cầu chì ngắt, job kế tiếp bị từ chối ngay trong 20,1 s dù link hợp lệ. Xem nợ kỹ thuật 7.5g

  Chênh lệch giữa thời gian giao diện (40,2-50,3 s) và thời gian xử lý trong DB (36,5-50,0 s) là ~3 s độ trễ polling 5 giây của app. **Đã sửa 2026-08-19** — nhịp polling nay theo trạng thái job, độ trễ xuống ~1 s; xem mục "Độ trễ do polling của giao diện" ở §6.

---

## 6. Số liệu đo thật

Từ 2026-08-16, mỗi job tự in **bảng chi phí** ở cuối (`automation/metrics.ts`), ở cả nhánh thành công lẫn nhánh lỗi. Đừng đo lại bằng đồng hồ bấm tay — đọc bảng đó.

### Job thật, đo qua API (2026-08-16)

| Khoản | Job 1 — cache nguội | Job 2 — cache trúng |
|---|---|---|
| Tạo session Appium | 13,1 s | 13,0 s |
| `getPageSource` (a11y) | 35 lần / 11,5 s | 25 lần / 11,7 s |
| `humanDelay` | 10 lần / 13,7 s | 8 lần / 9,9 s |
| Chờ cứng | 6 lần / 12,1 s | 4 lần / 7,9 s |
| OCR | 9 lần / 11,9 s | 5 lần / 5,3 s |
| Playwright tải trang | 11,3 s | 4,7 s |
| Ảnh chụp | 14 lần / 9,1 s | 6 lần / 4,0 s |
| Phase 2 (lấy link chia sẻ) | 19,0 s | **0,0 s** |
| **Tổng** | **101,1 s** | **68,7 s** |

Trừ tiếp session tái dùng (13 s) thì trạng thái ổn định vào khoảng **56 s**.

### Job thật thứ ba — 2026-08-17, sau khi sửa §4.9

Job `49dcc48a`, thành công, chạy đúng một lần: **73,6 s** (đồng hồ ngoài qua API: 74,3 s).

| Khoản | Thời gian |
|---|---|
| `appium-tao-session` | 11,4 s (16%) |
| `playwright-tai-trang` | 10,5 s (14%) |
| `a11y-tree` (27 lần) | 10,4 s (14%) |
| `human-delay` (8 lần) | 9,5 s (13%) |
| Chờ cứng (4 lần) | 7,9 s (11%) |
| `cho-vong-lap` (4 lần) | 5,0 s (7%) |
| OCR (7 lần) | 4,8 s (7%) |
| Ảnh chụp (8 lần) | 4,8 s (6%) |
| **phase-2** | **0,0 s** — cache trúng |
| phase-3 | 11,4 s |

### Hai job đo cuối, sau khi xong toàn bộ đợt 3 (2026-08-17)

Chạy liên tiếp, cùng cấu hình, khác nhau đúng một điều: job 2 tái dùng được session.

| Khoản | `49210657` — session mới | `588b91a4` — session tái dùng |
|---|---|---|
| `appium-tao-session` | 14,6 s | **0** (`⚡ Dùng lại session`) |
| `a11y-tree` | 27 lần / 17,5 s | 36 lần / 18,7 s |
| Chờ cứng | 5,4 s | 5,4 s |
| `cho-vong-lap` | 1,2 s | 4,9 s |
| `playwright-tai-trang` | 3,3 s | 2,4 s |
| `playwright-nap-truoc` | 3,9 s ⚠️ | 3,4 s ⚠️ |
| OCR | 3,3 s | 1,8 s |
| Ảnh chụp | 2,3 s | 2,3 s |
| **Tổng** | **63,2 s** | **51,6 s** |

⚠️ Cả hai job này trang đều đang **ấm** (`nap-truoc` 3-4 s thay vì ~10 s), vì có lệnh kiểm tra bộ sưu tập chạy ngay trước. Nên chúng **không** đo được lợi ích của prewarm — con số −8,6 s vẫn lấy từ job `bedc3c8a` chạy trên trang nguội.

**Con số trung thực hiện nay:**
- **≈ 52 s** ở trạng thái ổn định (các job thành công chạy nối nhau, session tái dùng)
- **≈ 63 s** cho job đầu sau một quãng nghỉ dài (phải dựng session)

Toàn bộ hành trình đo thật: **128 → 68,9 → 61,3 → 51,6 s**.

> ⚠️ **Đính chính dự phóng của chính bản ghi này.** Trong lúc làm đợt 3 tôi đã dự phóng "~42 s khi tái dùng session". Đo thật ra **51,6 s** — lệch 23%. **Đây là lần thứ TƯ liên tiếp một dự phóng tốc độ của dự án này lạc quan quá mức.** Nguyên nhân lần này: trừ đúng phần `appium-tao-session` nhưng quên rằng `a11y-tree` và `cho-vong-lap` phình ra khi các bước khác chạy nhanh hơn — app vẫn cần chừng ấy thời gian để render, và ta chỉ chuyển thời gian chờ từ ô này sang ô khác.
>
> **Quy tắc rút ra: đừng cộng trừ trên bảng chi phí để dự phóng. Chạy job rồi đọc số.**

**Biến động lớn cần biết:** `appium-tao-session` đo được từ **2,9 s** (tái dùng) tới **76,2 s** (ca cực đoan), phổ biến 10-15 s. `mo-sheet-chinh-sua` dao động **19,8-33,5 s** giữa các job giống hệt nhau. Nghĩa là một phép đo đơn lẻ không nói lên nhiều — luôn chạy ít nhất 2-3 job trước khi kết luận về một thay đổi.

### Trạng thái CUỐI sau nhóm A + B2 (2026-08-17, tối)

Job thật, session tái dùng — đây là con số nên dùng khi nói về tốc độ hiện nay:

| Khoản | Thời gian | Tỉ lệ |
|---|---|---|
| `a11y-tree` (37 lần) | 11,4 s | 29% |
| **Tap + gõ + app phản hồi** | ~16,5 s | 42% |
| Chờ cứng (6 lần) | 4,4 s | 11% |
| `playwright-tai-trang` | 3,5 s | 9% |
| `cho-vong-lap` (7 lần) | 2,9 s | 7% |
| Ảnh chụp (1 lần) | 0,6 s | 2% |
| OCR (1 lần) | 0,3 s | 1% |
| `appium-tao-session` | **0** (tái dùng) | — |
| `playwright-nap-truoc` | 4,7 s — NGOÀI đường găng | — |
| **Tổng** | **39,6 s** | |

Theo bước: `mo-sheet-chinh-sua` 15,8 s · `dan-link-va-tim` 7,9 s · `loc-nguoi-ban` 1,8 s · `tap-xong` 3,8 s · `tap-dang` 1,0 s · `phase-3` 9,1 s.

**Toàn bộ hành trình đo thật: 128 → 68,9 → 61,3 → 51,6 → 48,1 → 42,0 → 40,2 → 39,6 s** (giảm 69%).

Job đầu sau quãng nghỉ dài vẫn ~48-56 s vì phải dựng session.

### Độ trễ do polling của giao diện — nhịp cố định 5 giây → nhịp theo trạng thái (2026-08-19)

Người dùng quan sát một mẫu lạ: job xong ở giây 30 nhưng link hiện ở giây 35; job xong ở giây 34 cũng hiện ở giây 35; job hỏng cũng báo ở giây 35. Không ngẫu nhiên — đó là lưới `POLL_INTERVAL_MS = 5000`.

App chỉ **biết** job xong tại các mốc hỏi (t = 0, 5, 10, 15…). Job kết thúc ở thời điểm liên tục bất kỳ, nên thời gian người dùng thấy luôn bị **làm tròn LÊN mốc kế tiếp** — thêm **trung bình 2,5 giây, tối đa 5 giây** vào mọi job, thuần tuý do giao diện. Với job ~30 giây đó là ~8% thời gian chờ, và nó cũng làm mọi phép đo qua giao diện dài hơn thực tế.

Điều làm mẫu này khó nhận ra: app chạy **hai đồng hồ độc lập**. `setInterval(…, 1000)` chỉ để *hiển thị* số giây trôi qua (tick mượt từng giây), còn `setInterval(check, 5000)` mới là lúc app *thực sự hỏi* server. Người dùng nhìn đồng hồ thứ nhất nhưng kết quả chỉ đến theo nhịp đồng hồ thứ hai.

→ **Đã sửa: nhịp hỏi lấy theo `queue_position`, không theo `status`.**

```
queue_position > 1  (còn người phía trước)      → 35000ms   ≈ thời gian 1 job
queue_position ≤ 1  (sắp tới lượt / chưa rõ)    →  1000ms
status = processing (worker đang chạy)          →  1000ms
```

⚠️ **Vì sao KHÔNG dùng `status === 'pending'` làm mốc giãn nhịp** — đây là chỗ suýt tạo ra hồi quy tệ hơn cả bản 5 giây ban đầu.

Đo thật 2026-08-19: khi hàng đợi trống, job chuyển sang `processing` chỉ sau **249 ms**. Nhưng lượt hỏi đầu tiên của app xảy ra ở t ≈ 70 ms — tức là nó VẪN thấy `pending`. Nếu lúc đó hẹn lượt kế ở 35 giây:

```
job xong 27,4s  →  hỏi lúc 35s  →  người dùng chờ thêm 7,6 giây
```

`pending` chỉ nói "worker chưa nhận job", nó không nói "còn lâu mới tới lượt". `queue_position` mới trả lời đúng câu hỏi cần hỏi.

**Đo thật hai tình huống** (Playwright lái giao diện):

| | Hàng đợi TRỐNG | Có JOB CHẶN phía trước |
|---|---|---|
| job xong → link hiện ra | **0,69 s** | **0,76 s** |
| tổng bấm nút → kết quả | 38,7 s | 62,6 s |
| số lượt hỏi | 32 | **29** |
| lần giãn nhịp > 5 s | **0 lần** | **1 lần → 35,0 s** |
| các lượt còn lại | TB 1017 ms | TB 1016 ms |

Điểm mấu chốt: **độ trễ trả kết quả không đổi ở cả hai ca** (0,69 / 0,76 s), trong khi ca xếp hàng tiết kiệm được ~34 lượt hỏi. Giãn nhịp lúc xếp hàng không phải trả giá gì, vì ngay khi job chuyển sang `processing` thì nhịp về lại 1 giây.

→ **Đổi `setInterval` sang chuỗi `setTimeout` tự lên lịch**, vì hai lý do:
1. Chu kỳ của `setInterval` cố định từ lúc tạo, không đổi giữa chừng được.
2. Ở nhịp 1 giây, `setInterval` có thể bắn lượt mới khi lượt trước CHƯA trả lời — mạng chậm một nhịp là request chồng lên nhau. Chuỗi `setTimeout` chỉ hẹn lượt kế SAU KHI lượt này xong.

**Tách bạch từng khoản** (một lượt tiêu biểu, để thấy độ trễ nằm ở đâu):

```
bấm nút → gửi POST        0,08 s
POST đi và về             0,06 s
xử lý job                33,38 s
job xong → LINK HIỆN RA   0,64 s   ← toàn bộ phần polling
```

Chuỗi 5 lượt đo trước khi thêm nhịp xếp hàng: độ trễ **0,64 / 1,03 / 1,24 / 0,57 / 0,88 s** — trung bình **0,87 s**, so với trung bình 2,5 s / tệ nhất 5 s của bản cũ.

Chi phí: ~27-34 lượt gọi API mỗi job (thay vì ~7), và ít hơn nữa khi có xếp hàng. API trả lời trong 5-50 ms nên không đáng kể. Phần còn lại (~1 s) chính là chu kỳ hỏi — muốn nhỏ hơn nữa thì hạ `POLL_INTERVAL_MS`, đổi lấy số request tăng tỉ lệ nghịch; dưới ~500 ms thì nên chuyển hẳn sang long-poll hoặc SSE thay vì hỏi dày.

⚠️ **Một sai lầm đo đạc suýt mắc, ghi lại vì nó là mô-típ quen thuộc của dự án này.** Lượt đo đầu cho tổng giao diện 38,8 s so với `│ Tổng` trong log là 31,3 s — chênh 7,5 giây, và tôi đã nghi còn nguyên nhân ẩn nào đó. Không có: bảng chi phí chỉ đo phần **automation**, không gồm đẩy hàng đợi, worker nhận job, ghi Redis và DB. **So hai phép đo có biên khác nhau rồi coi chênh lệch là lỗi** — đúng kiểu sai đã ghi ở §4.9 và ở mục prewarm. Cách thoát vẫn thế: tách bạch từng khoản thay vì trừ hai con số tổng.

⚠️ **Hệ quả cho việc đo:** con số trên giao diện nay đã gần sát thật, nhưng **vẫn không phải số để trích dẫn**. Số đúng vẫn là bảng chi phí trong log (`│ Tổng: …`). Giao diện luôn cộng thêm phần POST và phần polling.

### Lô 5 job sau tối ưu session (2026-08-19, tối)

Cùng 5 link, cùng điều kiện với lô đo trước đó vài giờ — sản phẩm đã được xoá khỏi bộ sưu tập nên cả hai lô đều **gắn mới hoàn toàn**. Khác nhau đúng ba thay đổi về session (§4.14, §4.15, không xoá lúc tắt).

| | Lô TRƯỚC | Lô SAU | Δ |
|---|---|---|---|
| Số lượt chạy | 7 | 7 | — |
| **`appium-tao-session`** | **2 lần / 23,3 s** | **0 lần** | **−23,3 s** |
| Job thành công — trung bình | 41,2 s | **33,2 s** | **−8,0 s (−20%)** |
| Job thành công — nhanh nhất | 35,3 s | **32,1 s** | −3,2 s |
| Job thành công — chậm nhất | 44,7 s | **33,9 s** | −10,8 s |
| **Độ dao động** (chậm − nhanh) | **9,4 s** | **1,8 s** | **−81%** |
| Job hỏng vì link | 32,3 / 44,5 / 37,3 / 17,7 s | 31,1 / 18,5 / 25,8 / 16,1 s | — |
| Đồng hồ ngoài cả lô | 260 s | **196 s** | −64 s |

Ba lượt thành công, theo bước:

| Bước | L2 Áo len | L4 Máy cạo râu | L7 OPPO | TB | %TB |
|---|---|---|---|---|---|
| `mo-sheet-chinh-sua` | 14,5 s | 15,4 s | 15,0 s | **15,0 s** | 45% |
| `dan-link-va-tim` | 7,8 s | 8,7 s | 8,1 s | 8,2 s | 25% |
| `chon-san-pham` | 3,4 s | 3,4 s | 3,6 s | 3,5 s | 10% |
| `phase-3-trich-link` | 2,7 s | 2,5 s | 3,4 s | 2,9 s | 9% |
| `loc-nguoi-ban-shopee` | 1,5 s | 1,7 s | 1,5 s | 1,6 s | 5% |
| `tap-xong` | 1,5 s | 1,5 s | 0,9 s | 1,3 s | 4% |
| `tap-dang` | 0,7 s | 0,6 s | 1,2 s | 0,8 s | 3% |
| `phase-1` / `phase-2` | 0,0 s | 0,0 s | 0,0 s | 0,0 s | 0% |
| **TỔNG** | **32,1 s** | **33,9 s** | **33,7 s** | **33,2 s** | |

**Phát hiện đáng giá hơn con số trung bình: độ dao động sụp từ 9,4 s xuống 1,8 s.** Ba job giống nhau tới mức chênh nhau chưa tới 2 giây, trong khi CLAUDE.md từ lâu ghi rằng "một phép đo đơn lẻ không phân biệt được chênh lệch dưới ~4 giây". Nghĩa là **việc dựng lại session chính là nguồn nhiễu lớn nhất của mọi phép đo trước đây** — không chỉ vì 11-14 giây của nó, mà vì nó xuất hiện thất thường. Bỏ nó đi thì lần đầu tiên phép đo ở dự án này phân biệt được thay đổi cỡ 2 giây.

**`mo-sheet-chinh-sua` giờ cũng ổn định** (14,5 / 15,4 / 15,0 s, dao động 0,9 s), so với 16,8-27,0 s ở lô trước. Phần lớn biến động cũ của bước này hoá ra là session creation nằm lẫn bên trong nó, chứ không phải app render chậm như đã nghi.

**Bằng chứng luật §4.14 hoạt động trong luồng thật:** job 3 (Giày Asics) hỏng lần 1 ở `[mo-them-san-pham]` → log `ℹ️ Giữ session` → lần retry log `⚡ Dùng lại session Appium đang có`. Đúng ca đã tốn 12,1 s ở lô trước. Job 5 (OPPO) đi cùng đường và **thành công ở lần retry với 33,7 s**.

**Kết quả từng link** (không đổi so với lô trước — hai link hỏng là do dữ liệu, không phải hệ thống):

| Link | Kết quả |
|---|---|
| 1 · Áo Hoodie Zip | ❌ không có trong chương trình liên kết |
| 2 · Áo len ROWAY | ✅ `358123846/22557373779` |
| 3 · Giày Asics | ❌ YouTube Shopping không tìm thấy |
| 4 · Máy cạo râu | ✅ `1274547388/41353368596` |
| 5 · OPPO Reno12 | ✅ `1431261217/46862121649` |

Bộ sưu tập 3 → 6 sản phẩm, `checkCollectionExtractor` xác nhận 6/6 trích ngược ra đúng ID.

### Lô 9 job liên tiếp — phép đo vận hành thật đầu tiên (2026-08-17)

Đẩy 9 job vào hàng đợi cùng lúc, để chúng chạy nối nhau như khi hệ thống có tải.

| Chỉ số | Giá trị |
|---|---|
| Thành công | **9/9** (2 job cần chạy lại) |
| Thời gian xử lý trung bình | **52,5 s** |
| Trung vị | **50,5 s** |
| Nhanh nhất / chậm nhất | 48,0 s / 64,0 s |
| Tái dùng session | **7/9 job** |
| Đồng hồ ngoài cả lô | 8 phút 27 giây cho 9 job |
| **Thông lượng thật** | **56,3 s/job → ~64 job/giờ** |

Từng job: 51,0 / 49,4 / 58,5 / 50,5 / 49,7 / 51,5 / 48,0 / 64,0 / 50,2 s.

Con số **56,3 s/job** mới là thứ dùng để quy hoạch công suất: nó gồm cả hàng đợi, giới hạn nhịp 3 giây, và chi phí retry. Trần lý thuyết ~1.500 job/ngày, thực tế nên tính **800-1.000 job/ngày** sau khi trừ lỗi.

**Lô này cũng bắt được một lỗi hồi quy** — xem ngay dưới.

### Lỗi: chờ "thấy thẻ nào đó" thay vì "thấy ĐÚNG thẻ cần tìm"

2/9 job trong lô phải chạy lại với:

```
Không thấy bộ sưu tập tên "24/04". Hiện có: SP 6M-8M, SP 5M-6M, SP 4M-5M
Không thấy bộ sưu tập tên "24/04". Hiện có: SP 5M-6M, SP 4M-5M
```

Dải thẻ bộ sưu tập **render DẦN**, nên có thời điểm đã có 2-3 thẻ mà thẻ mục tiêu chưa hiện. Vòng chờ render (thêm ở lever 2) thoát ngay khi thấy ≥2 thẻ → đọc phải trạng thái dở dang.

Lỗi này **do chính đợt tối ưu lever 2 tạo ra**: chờ cứng 3 giây trước đó tình cờ đủ dài để cả dải kịp vẽ. Lại đúng mô-típ §4.8 — *một quãng chờ đang che giấu một điều kiện dừng sai*.

→ **Đã sửa:** điều kiện dừng đổi thành "đã thấy thẻ mang đúng tên cần tìm". Kiểm chứng 5/5 lượt dry-run đều liệt kê đủ `"24/04", "SP 6M-8M", "SP 5M-6M", "SP 4M-5M"`.

→ **Quy tắc:** khi chờ một danh sách render, điều kiện dừng phải là **phần tử mình cần**, không phải "danh sách đã có gì đó". Danh sách có phần tử không chứng minh nó đã đủ.

### Chi phí đơn vị — số cũ đã sai, dùng bảng này

| Thao tác | Đo được | Ghi chú |
|---|---|---|
| Tạo session Appium | **11-14 s** | Đo lại 2026-08-17 sau khi restart Appium server: 14,3 / 11,8 / 11,3 s. Con số **42,4 s** ghi trước đây là ca cực đoan (lần đầu tiên tuyệt đối, khi UiAutomator2 còn phải cài lên máy), **không phải mức thường gặp sau mỗi lần restart** — đừng dùng nó làm mốc quy hoạch |
| `getPageSource` (a11y tree) | **~330 ms** | ⚠️ số cũ 177 ms **SAI** — đo trên màn hình đứng yên. Thực tế UiAutomator2 phải chờ app rảnh |
| OCR toàn màn hình 1080×2400 (vie) | ~1100 ms | |
| `saveScreenshot` qua Appium | ~660 ms | |
| `chromium.launch()` | 264 ms | |
| Playwright tải trang bộ sưu tập | 3,0 s (ấm) / 11,3 s (nguội) | chờ `a[href*="shopee"]`, đã chặn ảnh |

**Trần công suất với 1 tài khoản:** ở 70 s/job → ~51 job/giờ → ~1.230 job/ngày (lý tưởng) → thực tế **600-800 job/ngày** sau khi trừ lỗi và retry. Gần gấp đôi so với mốc cũ 300-400.

---

## 7. Vấn đề đã biết / nợ kỹ thuật

Sắp theo mức độ nghiêm trọng:

1. ~~**Retry gắn trùng sản phẩm**~~ — ✅ **ĐÃ SỬA**: `services/jobCheckpoint.ts` ghi checkpoint ngay sau khi Đăng thành công; lần retry đọc thấy checkpoint sẽ bỏ qua Phase 1, chạy thẳng Phase 2.
2. ~~**Job kẹt `pending` vĩnh viễn**~~ — ✅ **ĐÃ SỬA**. Nguyên nhân gốc *không phải* rác dữ liệu mà là bug thật: Fastify, BullMQ Queue và Worker **dùng chung một kết nối Redis**, khiến `addJobToQueue` thất bại với `Connection is closed`. Lỗi lại bị `try-catch` nuốt, nên người dùng nhận `job_id` rồi chờ vô hạn một job không bao giờ chạy. Đã tách kết nối riêng cho từng thành phần (`createRedisConnection()`), và khi không đẩy được queue thì đánh dấu job `failed` + trả HTTP 503.
3. ~~**`AVG_JOB_SECONDS` sai**~~ — ✅ **ĐÃ SỬA ba lần.** `40` → `120` (2026-08-15) → **`75`** (2026-08-16) → **`45`** (2026-08-17, sau khi job xuống ~40 s). Mỗi lần đều phải sửa **cả ba nơi**: `.env`, `.env.example`, và giá trị mặc định trong `config.ts` — chỗ cuối từng bị bỏ quên nhiều tuần vì `.env` luôn ghi đè nên không ai thấy. Chi tiết hai lần đầu: sau khi job thật xuống còn 68,7-101 s. Đã đổi ở cả ba nơi: `.env`, `.env.example`, và **giá trị mặc định trong `config.ts`** — chỗ cuối này vẫn còn là `40` suốt nhiều tuần vì `.env` luôn ghi đè nên không ai thấy.
   Kèm theo: `formatWaitTime()` trước đây đổi sang phút ngay từ 60 giây và **luôn làm tròn lên**, nên 75 giây hiện ra là "~2 phút" — thừa 60%. Vô hại khi job mất 120 s, nhưng sau tối ưu thì phần lớn ước tính rơi đúng vào vùng hỏng đó. Nay dưới 2 phút nói bằng giây, trên 2 phút làm tròn tới phút gần nhất.
3b. ~~**Tap "+" không ăn nhưng vẫn báo thành công**~~ — ✅ **ĐÃ SỬA**: xác minh sau khi tap, thử lại tối đa 3 lần, thất bại thì dừng (xem §4.5).
3c. ~~**Job bị đánh dấu `failed` ngay lần thử đầu dù còn retry**~~ — ✅ **ĐÃ SỬA**. BullMQ bắn sự kiện `failed` sau *mỗi* lần thử (đo thật với bullmq 6.1.0: `attempts=3` → 3 lần bắn), nhưng `worker.ts` ghi `status='failed'` ngay lần đầu. Hậu quả: người dùng thấy "thất bại" trong khi job vẫn đang chờ retry; và vì chốt chặn 1-job/user chỉ tính `pending`/`processing`, họ gửi được link mới chạy song song với lần retry cũ. Nay chỉ ghi `failed` khi thất bại thật, nhận biết qua `job.finishedOn` — dấu hiệu này đúng cả khi BullMQ dừng sớm vì `UnrecoverableError` (lúc đó `attemptsMade` vẫn nhỏ hơn `attempts`, nếu chỉ so số lần thử thì job sẽ kẹt vĩnh viễn).

3d. ~~**Tap nhầm nút "Bỏ chọn sản phẩm" → gỡ sản phẩm khỏi bộ sưu tập**~~ — ✅ **ĐÃ SỬA** 2026-08-16, xem §4.7.
3e. ~~**Trả link của sản phẩm khác khi trang chưa cập nhật**~~ — ✅ **ĐÃ SỬA** 2026-08-16, xem §4.8.
3f. ~~**Job thành công bị báo `failed` và chạy lại trên máy thật**~~ — ✅ **ĐÃ SỬA** 2026-08-17, xem §4.9. Đây là lỗi nghiêm trọng nhất tính tới nay xét theo hậu quả tiềm tàng: nếu không có chốt §4.7 thì lần chạy lại đã **gỡ sản phẩm khỏi bộ sưu tập thật** rồi đăng lại.

4. **Chưa có xác thực.** `user_id` nhận thẳng từ client, chưa có JWT/Firebase (đã ghi TODO trong `schema.ts`).
4b. ~~**`services/shopee.ts` là mock và đang bịa dữ liệu ra API thật**~~ — ✅ **ĐÃ SỬA 2026-08-16.** `fetchShopeeProduct()` chọn tên từ một mảng 5 phần tử cứng theo *chữ số cuối của productId*; quan sát thật: gửi link một chiếc Samsung Galaxy A17, API trả `"Máy lọc không khí Xiaomi Air Purifier 4 Pro"`. Đã gỡ hẳn hàm này và kiểu `ShopeeProduct`. Nay `name` và `image` **luôn `null`**, còn `id` bóc thật từ URL người dùng gửi (null với link rút gọn). Kiểm chứng qua API thật:
```
link đầy đủ : {"id":"42529174899","name":null,"image":null}
link rút gọn: {"id":null,"name":null,"image":null}
```
   `parseShopeeUrl()` nay uỷ quyền cho `automation/shopeeLink.ts` thay vì giữ bản sao regex riêng — hai nơi hiểu URL khác nhau sẽ sinh sai lệch âm thầm ở bước so khớp sản phẩm.
   **Muốn có tên/ảnh thật thì phải tích hợp Shopee Affiliate Open API. Đừng dựng lại mock.**
5. ~~**Circuit breaker chưa từng được kích hoạt thử.**~~ — ✅ **đã chạy thật 2026-08-17**: 3 lỗi liên tiếp của job `daca8661` làm cầu chì ngắt đúng như thiết kế (`🚨 CẦU CHÌ ĐÃ NGẮT! Trạng thái OPEN. Tạm dừng worker trong 30s`), rồi tự đóng lại sau 30 giây. Không phải bài test có chủ đích, nhưng là kiểm chứng thật.
5b. **Không có cơ chế cứu job kẹt `processing`.** Tiến trình chết hoặc điện thoại rớt USB giữa chừng thì dòng DB nằm mãi ở `processing`, và người dùng đó **bị khoá vĩnh viễn** không gửi được job mới vì chốt chặn 1-job/user. Cần quét lúc khởi động: job `processing` quá lâu → đánh `failed`. **Chưa làm.**
5c. **Script CLI không tự thoát dù đã dọn dẹp.** `testMobileCollectionTagging.ts` chạy xong việc nhưng tiến trình treo mãi, chiếm ~345 MB, phải Ctrl+C. Đã loại trừ hai nghi phạm rõ ràng: `closeOcr()` (worker tesseract) và `deleteSession()` (Appium) — cả hai đều được gọi đúng mà vẫn treo. **Chưa truy ra phụ thuộc nào giữ handle.** Tạm thời script gọi `process.exit()` tường minh ở cuối `finally` — đây là che đi, không phải sửa gốc. Hệ quả thật: mọi phép đo bằng `Measure-Command` đều treo trước khi phát hiện ra.

5d. ~~**`execSync` của adb chặn cứng event loop Node.**~~ — ✅ **ĐÃ SỬA 2026-08-17**, xem §4.9. Trước khi sửa nó đã gây hai lỗi thật: `resolveProductRef()` bị huỷ oan (vá tạm bằng cách nới hạn lên 45 s), và nghiêm trọng hơn nhiều là **BullMQ mất lock giữa job** khiến một job thành công bị báo `failed` rồi chạy lại 2 lần trên máy thật. Nay `adb.ts` / `deviceHealth.ts` / `appiumYoutubeStudio.ts` đều dùng `execFile` bất đồng bộ, nhận **mảng tham số** thay vì chuỗi shell.
   Đo lại từ bên trong tiến trình sau khi sửa: `preflightCheck` chỉ còn chặn **40 ms**, `remote()` tạo session **619 ms**, OCR và ảnh chụp dưới 20 ms. Không còn khoản nào đáng lo. (Con số "17,8 s còn lại" ghi trong bản nháp trước là **sai** — lỗi phương pháp đo, xem cảnh báo ở §4.9.)

5g. ~~**Cầu chì không phân biệt "lỗi do link người dùng" với "lỗi do hệ thống"**~~ — ✅ **ĐÃ SỬA 2026-08-17.**

`automation/errors.ts` định nghĩa `LoiDauVao`. Ba chỗ trong `selectMatchingProduct` ném nó thay cho `Error` thường: sản phẩm đã có sẵn, không nằm trong chương trình liên kết, chỉ có kết quả tương tự. Ba tầng xử lý theo:

1. `youtubeAutomation` ném nguyên văn, **không bọc tiền tố** `[Automation Failed]` — thông báo này đi thẳng tới người dùng.
2. `worker.ts` chuyển thành `UnrecoverableError` → BullMQ **không retry**.
3. **Không gọi** `recordFailure()` → cầu chì không bị đếm oan.

**Kiểm chứng thật** (job `b3b3302e`, link sản phẩm đã có trong bộ sưu tập):

```
[Worker] dừng vì lỗi đầu vào (không retry): Sản phẩm này đã có trong bộ sưu tập rồi.
[Worker Event] thất bại hẳn sau 1/3 lần thử
```

**1/3 lần thử** (trước: 3/3), **31,5 s** (trước: ~120 s), **không có dòng CircuitBreaker nào**.

**Kèm theo — sửa một lỗi thông báo có thật.** Chốt "không tìm thấy sản phẩm" nằm TRƯỚC chốt "đã có sẵn", nên khi sản phẩm đã trong bộ sưu tập, hàng của nó mang nhãn `"Bỏ chọn sản phẩm"` khiến `addButtons = 0` và người dùng nhận thông báo *"không tìm thấy sản phẩm"* — trong khi chốt đúng nằm phía dưới và không bao giờ chạy tới. Đã đảo thứ tự.

**Nguyên tắc phân loại** (ghi trong `errors.ts`): là lỗi ĐẦU VÀO khi automation chạy đúng, giao diện phản hồi đúng, và kết luận rút ra là về dữ liệu người dùng — tức chạy lại y hệt sẽ cho đúng kết quả đó. Khi phân vân thì chọn lỗi hệ thống: retry thừa chỉ tốn thời gian, còn bỏ sót lỗi hệ thống thật thì mất cả cầu chì lẫn cơ hội tự phục hồi.

5h. **Thông báo lỗi HỆ THỐNG vẫn còn kỹ thuật.** Lỗi không thuộc nhóm đầu vào vẫn tới người dùng dưới dạng `[Automation Failed] [chon-chinh-sua] Tap [Chỉnh sửa] 3 lần nhưng...` kèm đường dẫn ảnh trên ổ đĩa máy chủ. Người dùng không làm gì được với thông tin đó, mà nó lại lộ cấu trúc nội bộ. Nên có một câu chung kiểu "Hệ thống đang gặp sự cố, vui lòng thử lại sau" cho nhóm này, giữ chi tiết trong log. **Chưa làm.**

Quan sát thật 2026-08-17 khi chạy 5 job qua giao diện web:

```
Job 1 (link sản phẩm đã có trong bộ sưu tập) → chốt §4.7 chặn, hỏng 3 lần
   → CircuitBreaker ngắt
Job 2 (link hoàn toàn hợp lệ)                → bị từ chối ngay trong 20,1 s
   → "[CircuitBreaker] Cầu chì đang ở trạng thái OPEN"
Sau 30 s: HALF_OPEN → CLOSED, job 3/4/5 chạy bình thường
```

Cầu chì tồn tại để bảo vệ tài khoản khi automation gãy (YouTube đổi giao diện, session hỏng). Nhưng nó đang đếm CẢ những lỗi thuộc về **dữ liệu đầu vào của người dùng** — mà loại lỗi đó không nói gì về sức khoẻ hệ thống, và lặp lại bao nhiêu lần cũng không có nghĩa là nên dừng.

Hiện chưa gây hại nhiều vì mỗi lúc chỉ có một người dùng. Nhưng khi có nhiều người, **một người dán link xấu ba lần sẽ làm hỏng job của người tiếp theo**.

→ **Cách sửa đúng:** phân loại lỗi ở `youtubeAutomation.ts` trước khi gọi `recordFailure()`. Lỗi "sản phẩm đã có sẵn", "không tìm thấy sản phẩm khớp link", "chỉ có kết quả tương tự" đều là lỗi ĐẦU VÀO — nên trả về người dùng mà không đụng tới cầu chì. Chỉ lỗi hạ tầng (Appium chết, thiết bị rớt, không thấy màn hình mong đợi) mới đáng đếm. **Chưa làm.**

5f. **Máy Xiaomi tự tắt "Gỡ lỗi USB (Cài đặt bảo mật)" sau khi khởi động lại — làm CHẾT mọi session Appium.**

Gặp thật 2026-08-17: mọi session đột ngột hỏng dù cùng ngày vẫn chạy bình thường. Hai triệu chứng nối tiếp nhau:

```
SecurityException: Permission denial, must have one of: [android.permission.WRITE_SECURE_SETTINGS]
   ← Appium chạy `settings put/delete global hidden_api_policy*` ở đầu/cuối session

SecurityException: You need android.permission.INSTALL_GRANT_RUNTIME_PERMISSIONS
to use INSTALL_GRANT_ALL_REQUESTED_PERMISSIONS
   ← `adb install -g` app trợ giúp io.appium.settings
```

Cả hai đều bắt nguồn từ một tuỳ chọn nhà phát triển RIÊNG trên MIUI: **"Gỡ lỗi USB (Cài đặt bảo mật)"**, vốn tự tắt sau mỗi lần reboot. Triệu chứng gây lạc hướng vì nó trông như lỗi Appium hoặc lỗi code.

→ **Đã xử lý hai lớp:**
1. Thêm capability `appium:ignoreHiddenApiPolicyError: true` — luồng không dùng hidden API nào (chỉ đọc cây a11y, tap toạ độ, bắn intent) nên bỏ qua lỗi đó là an toàn.
2. Cài tay app trợ giúp **không kèm cờ `-g`**: `adb install -r "<...>/io.appium.settings/apks/settings_apk-debug.apk"` → `Success`.

Cách chữa gốc là bật lại tuỳ chọn trên máy. Kiểm tra nhanh khi nghi ngờ: `adb shell pm list packages | grep io.appium` — thiếu `io.appium.settings` là dấu hiệu.

5e. **Tiến trình Appium mồ côi sau khi dừng.** Dừng `npx appium` bằng cách giết tiến trình cha để lại tiến trình con **vẫn sống và vẫn trả `/status` OK, nhưng không spawn được adb nữa** (`exited with code 3221225794`). Triệu chứng gây lạc hướng: server "khoẻ" mà mọi session đều lỗi. **Luôn dừng theo cổng**, không dừng theo tiến trình cha:
```powershell
Get-NetTCPConnection -LocalPort 4723 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

6. **Máy ảo đã thử nhưng bỏ** — quá chậm do `hw.gpu.enabled=no`, RAM 2G, và ổ C: đầy 99%. **Đã chốt dùng điện thoại thật cắm USB vào server.** Xem mục 11.
7. Hai cột `result_url`, `result_voucher` vẫn còn trong DB hiện tại (không được ghi nữa, vô hại). Xoá bằng `ALTER TABLE jobs DROP COLUMN result_url, DROP COLUMN result_voucher;`
8. **Ổ C: còn 2.7 GB / 187 GB.** Docker, Appium, Windows đều ghi lên đó.

9. ~~**Container `affiliate_api` tự bật lại và chiếm cổng 3000**~~ — ✅ **ĐÃ SỬA 2026-08-19.**

Triệu chứng rất dễ dẫn sai hướng: `npm run dev` trên host báo `EADDRINUSE 0.0.0.0:3000`, nhưng `netstat` **không thấy tiến trình Node nào** giữ cổng. Phiên trước kết luận là "lỗi ma của Docker Desktop" và phải khởi động lại cả máy.

Nguyên nhân thật đơn giản hơn nhiều: §9 của tài liệu này ghi *"Đã tắt auto-restart"* cho container `api`, nhưng trong `docker-compose.yml` nó vẫn là `restart: unless-stopped`. Docker Desktop khởi động cùng Windows → container tự sống lại → **proxy của Docker giữ cổng 3000**. Cổng nằm trong tiến trình proxy chứ không phải trong một tiến trình Node, nên tìm theo Node thì không bao giờ thấy.

Đây là một **tài liệu nói dối về code** — đúng loại sai lệch khó bắt nhất, vì người đọc tin tài liệu và đi tìm nguyên nhân ở chỗ khác.

→ **Đã sửa:** `restart: "no"` + `profiles: ["docker-only"]`. Nay `docker compose up -d` **không** khởi động container này nữa, và Docker Desktop cũng không tự bật lại. Muốn chạy có chủ đích thì gọi tường minh:

```bash
docker compose --profile docker-only up -d api
```

**Cách chẩn đoán đúng khi gặp lại kiểu này** — hỏi *ai* đang giữ cổng, đừng đoán:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess }
```

Lệnh này trả về cả tiến trình của Docker lẫn của Node, nên phân biệt được ngay hai ca.

10. **Dừng `npm run dev` bằng cách giết tiến trình cha KHÔNG giải phóng cổng 3000.**

`ts-node-dev` sinh tiến trình con; giết cha để lại con **vẫn sống và vẫn giữ cổng**. Lần khởi động lại kế tiếp báo `EADDRINUSE`, trông hệt như mục 9 ở trên nhưng nguyên nhân hoàn toàn khác.

Đây đúng là mô-típ đã ghi ở 7.5e cho Appium, chỉ đổi tiến trình. **Luôn dừng theo cổng, không dừng theo tiến trình cha:**

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## 8. Việc cần làm tiếp

### Ưu tiên cao (chặn MVP)

- [x] Chốt nơi đặt thiết bị: **điện thoại thật cắm USB vào server**
- [x] Sửa lỗi retry gắn trùng (checkpoint)
- [x] Sửa bug Redis nuốt job
- [x] Cập nhật `AVG_JOB_SECONDS` về 120
- [x] **Chạy một job thật qua API** — đã đóng vòng lặp, 128 giây
- [x] Sửa lỗi đánh dấu `failed` sớm khi BullMQ còn retry
- [x] **Tối ưu tốc độ đợt 2** — 128 s → **68,7 s**, kiểm chứng bằng job thật qua API
- [x] Sửa lỗi tap nhầm nút gỡ sản phẩm (§4.7)
- [x] Sửa lỗi trả link sai sản phẩm (§4.8)
- [x] **Bỏ mock trong `services/shopee.ts`** — không còn bịa tên sản phẩm ra phản hồi API (nợ kỹ thuật 7.4b)
- [x] Cập nhật `AVG_JOB_SECONDS` về `75` ở cả ba nơi, và sửa cách diễn đạt thời gian chờ
- [x] **Tối ưu tốc độ đợt 3 + nhóm A + B2** — 73,6 s → **~40 s**, kiểm chứng bằng nhiều job thật
- [x] **Đóng vòng lặp người dùng đầu-cuối qua GIAO DIỆN** — 5 job thật trên bản web, xem §5
- [ ] Xác thực người dùng (thay `user_id` nhận từ client)
- [ ] Cứu job kẹt `processing` khi tiến trình chết (nợ kỹ thuật 7.5b)
- [ ] **Cầu chì không được đếm lỗi do link người dùng** (nợ kỹ thuật 7.5g) — hiện một link xấu làm hỏng job của người kế tiếp

### Ưu tiên trung bình

- [x] ~~Giao diện cho người dùng~~ — bản web đã chạy job thật; bản mobile còn chờ máy thứ hai
- [ ] Xác thực người dùng
- [ ] Cảnh báo khi circuit breaker mở / session chết
- [ ] Job test tự động hàng ngày để phát hiện sớm khi YouTube đổi giao diện

### Tối ưu tốc độ

#### Chi phí đơn vị

Đã chuyển sang **§6** và cập nhật bằng số đo từ bảng chi phí tự động. Lưu ý con số `getPageSource = 177 ms` ghi ở đây trước đây là **SAI**.

#### Đã làm — đợt 2 (2026-08-16 chiều), 128 s → 68,7 s

Xếp theo mức tiết kiệm đo được:

- [x] **Cache link chia sẻ bộ sưu tập** (`services/collectionShareLink.ts`) — **−19,0 s**, đo trực tiếp qua `phase-2 = 0,0 s`. Bằng chứng cho giả định "link không đổi": hai lần chia sẻ cho cùng đường dẫn `SCUCNWkaKv5uJZkFrKH503EWIKyAPnZzfJZqg`, chỉ khác tham số `si`. Cache lưu URL đã **cắt phần truy vấn** — giữ lại `si` cũ nghĩa là mọi job đều báo cùng một mã phiên chia sẻ cho YouTube. Cache tự chữa: link không trích được sản phẩm thì xoá cache, lấy lại bằng Appium, thử lại một lần.
- [x] **Tái dùng session Appium giữa các job** — **−13 s**. Vẫn `force-stop` app ở đầu mỗi job nên đảm bảo trạng thái sạch của §4.6 còn nguyên; 13 giây kia là chi phí bắt tay UiAutomator2, không phải khởi động app. Session bị huỷ sau mỗi job **thất bại** để lần retry bắt đầu mới. Tắt bằng `APPIUM_REUSE_SESSION=0`.
- [x] **Playwright chờ đúng thứ cần chờ** — **~−8 s**. Bỏ `networkidle` (trang YouTube bắn beacon liên tục nên gần như không bao giờ "im lặng") → `domcontentloaded` + `waitForSelector('a[href*="shopee"]')`. Bỏ `waitForTimeout(3000)`. Chặn `image`/`media`/`font`. Ảnh `fullPage` chuyển hẳn xuống nhánh lỗi. **Cố ý KHÔNG chặn `stylesheet`**: `innerText` trả về chữ đang hiển thị, bỏ CSS thì phần tử ẩn lọt vào text.
- [x] **Cache toạ độ nhãn phải tìm bằng OCR** (`automation/labelCache.ts`) — **−5,3 s** (OCR 8→5 lần, ảnh chụp 9→6). Học một lần rồi lưu ra đĩa. **Chỉ dùng sau một lớp xác minh**, và trước khi tap toạ độ nhớ sẵn còn hỏi lại cây a11y xem điểm đó bây giờ là cái gì. **Menu ngữ cảnh bộ sưu tập bị loại trừ hẳn** vì "Xoá" nằm ngay cạnh "Chỉnh sửa", mà xác minh sau khi tap không hoàn tác được một lần xoá.
- [x] **Bốn chờ cứng nữa → chờ theo điều kiện** — chờ cứng còn ~6,7 s trên đường thành công (trước 26 s). Đáng chú ý: `delay(5000)` sau "Đăng" → `waitForGone(['Chỉnh sửa bộ sưu tập'])`, đo thật **chỉ 1,9-2,2 s** và còn chặt hơn vì chứng minh sheet đã đóng thật.
- [x] **So khớp sản phẩm theo ID thay vì theo tên** — không phải tối ưu tốc độ mà là **sửa lỗi đúng đắn**, xem §4.8.
- [x] **Bộ đếm chi phí** (`automation/metrics.ts`) — việc làm đầu tiên của đợt này, và là lý do mọi con số trên đây tách bạch được khỏi nhiễu ±4 s.

#### Đã làm — đợt 1

- [x] **Tắt ảnh chụp mốc trên đường thành công** — đo A/B trên thiết bị thật: **85,1 s → 76,4 s (giảm 8,6 s)**. Ảnh nhánh lỗi vẫn luôn chụp. Bật lại bằng `AUTOMATION_CHECKPOINT_SHOTS=1`; `DRY_RUN=1` tự bật; `AUTOMATION_CHECKPOINT_SHOTS=0` tắt tường minh (dùng khi đo).
- [x] **Bộ nhớ đệm OCR theo nội dung ảnh** — nếu ảnh chụp giống hệt lần trước từng byte thì dùng lại kết quả OCR. Đo thật: **1 lần/job, ~2 s**, thấp hơn kỳ vọng 4-6 s.

#### Đã thử và BỎ — đừng làm lại

- **Cắt vùng ảnh trước khi OCR**: truyền `rectangle` cho tesseract.js làm **mất hẳn nhãn** khỏi kết quả (thử cả vùng 0-900 và 400-1300, nhãn "Người bán" biến mất trong khi OCR toàn khung tìm thấy ở y=608). Ước lượng 15-20 s là sai.
- **Đổi chế độ phân tích trang (PSM)**: PSM 11 và PSM 6 đều **chậm hơn** mặc định (3182 và 2907 ms so với 2779 ms cho 2 ảnh), và PSM 11 còn khớp nhầm sang cụm chữ khác cách 960 px.
- **Giữ ấm Chromium giữa các job**: `chromium.launch()` chỉ tốn 264 ms, mà muốn cách ly trạng thái phải đổi `newPage()` thành `newContext()` tốn 225-633 ms → hoà vốn. ~20 s của Phase 2 nằm ở **tải trang**, không phải khởi động trình duyệt.
- ~~**Nạp trước trang bộ sưu tập song song với Phase 1**~~ — ❌ **KẾT LUẬN CŨ ĐÃ BỊ BÁC BỎ 2026-08-17.** Phép đo 2026-08-16 cho "mở nguội 3325 ms so với nạp sẵn rồi reload 3418 ms, âm 93 ms" là **sai phương pháp**, và cái sai chính là lỗ hổng đã tự ghi lại: hai nhánh chạy liên tiếp trên cùng URL nên nhánh "nguội" đã được lượt trước làm ấm. **Cả hai con số đều là số của trang ẤM.** Nay prewarm **BẬT mặc định** — chi tiết ở §8, mục "Đợt 3".

#### ⚠️ Cảnh báo phương pháp đo — đọc trước khi tin bất kỳ con số nào dưới đây

Chạy **3 lượt dry-run trên code y hệt nhau**: 64,3 / 67,9 / 68,5 giây. Trung bình 66,9 s, **biên độ 4,2 giây**.

Nghĩa là **một lần đo không phân biệt được chênh lệch dưới ~4 giây**. Các con số "−2,0 s", "−2,4 s", "+1,9 s" trong bảng dưới đều đo một lần nên nằm trong nhiễu — chúng cho biết hướng, không cho biết độ lớn. Muốn kết luận về một thay đổi nhỏ thì phải chạy lặp và lấy trung bình.

Chỉ hai con số dưới đây đủ lớn để vượt nhiễu:
- **Tắt ảnh chụp mốc: −8,6 s** (đo A/B liên tiếp, khớp với tính toán 11 × 604 ms)
- **Tổng cả ngày: 85,1 → 66,9 s (−18,2 s)**

#### Chờ cứng → chờ theo điều kiện (làm 2026-08-16, đo từng bước)

| Chỗ | Việc | Kết quả | Quyết định |
|---|---|---|---|
| Sau khi lọc Shopee | Bỏ `delay(5000)` — `selectMatchingProduct()` đã mở đầu bằng `waitFor(['Chọn sản phẩm'], 30s)` | −2,0 s | ✅ giữ |
| Sau deep link | Bỏ `delay(3000)` trước `waitFor(['Mua sắm'])` | **0 s** | ❌ **đã gỡ** |
| Sau khi tap thẻ bộ sưu tập | Bỏ `delay(2500)` — cả hai nơi gọi đều `waitFor` mục menu ngay sau | −2,4 s | ✅ giữ |
| Sau khi tap "Chỉnh sửa" | `delay(3000)` → `waitFor(['Chỉnh sửa bộ sưu tập'])` | −3,4 s | ✅ giữ |
| Sau khi mở "Người bán" | `delay(2500)` → `waitFor(['Shopee'])` | — | ❌ **từ chối** |
| Sau khi tap "Xong" | `delay(3500)` → `waitFor(['Chỉnh sửa bộ sưu tập'])` | ~0 s | ✅ giữ vì **đúng hơn**, không vì nhanh hơn |
| Vòng chờ | Hỏi a11y nhịp dày, 4 lượt mới OCR 1 lần | không kết luận được | ❌ đã gỡ |

**Vì sao gỡ chỗ deep link:** không tiết kiệm được giây nào, mà bỏ đi thì `find()` chạy ngay lúc intent vừa bắn, khi màn hình CŨ còn hiển thị. Nhãn "Mua sắm" có mặt ở cả thanh điều hướng dưới nên `waitFor` có thể khớp trên màn cũ. Log mọi lần chạy đều có `intent has been delivered to currently running top-most instance` — app đang mở sẵn, nên rủi ro này là thật.

**Vì sao từ chối chỗ "Người bán":** ảnh `05_link_entered` cho thấy chữ "Shopee" ĐÃ có sẵn trên thẻ sản phẩm (dòng tên người bán) trước khi mở bộ lọc. `waitFor(['Shopee'])` sẽ trả về tức thì và tap lúc dropdown chưa mở.

**Chỗ "Xong" — dump a11y hai đầu (bằng chứng, không suy đoán):**

```
trước khi tap: [Nút kéo | Thêm sản phẩm | Quay lại | <url> | Xoá nội dung tìm kiếm |
                Xoá người bán đã chọn | Bỏ chọn sản phẩm | Các kết quả tương tự |
                Chọn sản phẩm | Chọn sản phẩm | Xem sản phẩm đã chọn | Xong | Mua sắm]
sau khi tap:   [Nút kéo | Chỉnh sửa bộ sưu tập | Đóng | Tải ảnh bìa mới lên | 24/04 |
                Mô tả nội dung... | Thêm sản phẩm | Đặt mua lại sản phẩm | ... | Đăng | Mua sắm]
```

Hai điều rút ra:

1. **Xác nhận dứt điểm nguyên nhân §4.6**: nhãn `"Thêm sản phẩm"` có mặt ở CẢ HAI trạng thái — trước là tiêu đề sheet thêm sản phẩm, sau là `content-desc` của nút "＋ Thêm" trên sheet chỉnh sửa. Đây là lý do `waitFor(['Thêm sản phẩm'])` khớp lại đúng cái nút vừa bấm.
2. **Lo ngại "sheet dưới rò vào cây a11y" là SAI**: toàn bộ nhãn của sheet chỉnh sửa (`Chỉnh sửa bộ sưu tập`, `Đóng`, `24/04`, `Đăng`) vắng mặt hoàn toàn trước khi tap. Nên dùng được làm dấu hiệu.

**Quy tắc rút ra:** trước khi đổi một `delay()` thành `waitFor`, phải kiểm tra dấu hiệu định chờ có mặt trên màn hình TRƯỚC thao tác hay không — bằng ảnh chụp hoặc dump a11y thật, không bằng suy luận.

#### Đợt 3 — 2026-08-17, 73,6 s → 63,2 s (job thật `f925e175`)

Mục tiêu đặt ra là 25-30 s. **Không đạt, và có lý do cấu trúc** — xem "Vì sao 25-30 s không khả thi" ở dưới.

Đã làm, xếp theo mức tiết kiệm **đo được bằng số đếm** (không phải bằng tổng thời gian, vốn nhiễu ±2-4 s):

- [x] **Tắt `humanDelay`** — **−9,5 s**. Đây là **quyết định đánh đổi rủi ro của chủ dự án**, không phải phát hiện kỹ thuật. Để dưới dạng cờ `AUTOMATION_HUMAN_DELAY=1` để bật lại ngay khi thấy captcha / yêu cầu xác minh thiết bị. Cái giá: nhịp thao tác giờ đều như máy, trên tài khoản duy nhất đủ điều kiện.
- [x] **Lớp chặn của `mo-them-san-pham` chuyển sang tree-only** — OCR **7 → 2 lần**, ảnh chụp **8 → 3 lần**. Mở khoá được nhờ dump mới `flow_06_add_product.xml`: nhãn `"Tìm sản phẩm"` **có** trong cây a11y sau khi tap "Thêm" và **không có** trước đó (`flow_05_collection_edit.xml`) — thoả §4.6 mà không cần OCR. Đây chính là việc CLAUDE.md ghi "cần một dump a11y ở trạng thái sheet vừa mở" từ đợt 2.
- [x] **`waitFor` có chế độ `treeOnly`** — bỏ chụp ảnh + OCR mỗi lượt hỏi, và vì mỗi lượt rẻ đi ~5 lần nên hỏi dày hơn được (400 ms thay vì 1500 ms). Bật ở `mo-man-mua-sam`, `cho-ket-qua-tim-kiem-tho`, `cho-ket-qua-tim-kiem` — cả ba nhãn đã xác nhận có trong cây a11y bằng dump.
- [x] **`delay(2500)` sau khi mở dropdown "Người bán" → chờ theo điều kiện** — **−2,5 s** (chờ cứng 4 lần/7,9 s → 3 lần/5,4 s), bước lọc từ 4,7 s xuống 3,3 s.

- [x] ~~**Nạp trước trang bộ sưu tập (`PLAYWRIGHT_PREWARM`) — BẬT mặc định**~~ — ⚠️ **ĐÃ GỠ 2026-08-19**: Phase 3 nay là `fetch` tốn 0,2-0,4 s, không còn 10 giây tải trang nguội nào để giấu. Cờ và hàm `prewarmCollectionPage` đều đã xoá. Giữ lại đoạn dưới vì phương pháp đo của nó vẫn đáng học (xem mục kế tiếp), nhưng **con số thì đã hết hiệu lực**. Nguyên văn khi còn dùng Playwright: **−8,6 s trên đường găng**, đo bằng job thật `bedc3c8a`:

  ```
  playwright-nap-truoc  : 9,9 s   ← chạy SONG SONG Phase 1, ngoài đường găng
  playwright-tai-trang  : 2,4 s   ← chi phí thật trên đường găng
  job không prewarm     : 11,0 s  ← baseline (f925e175)
  ```

  Cần `YT_COLLECTION_NAME` đặt tường minh (đã đặt `24/04` trong `.env`), nếu không thì lúc job bắt đầu chưa biết địa chỉ trang và prewarm chỉ mở trình duyệt rỗng.

#### Cách phân xử một phép đo đã từng cho kết quả sai — mẫu việc nên lặp lại

Vụ prewarm đáng ghi lại vì nó là mẫu cho việc "đo lại một thứ đã bị kết luận sai".

**Bước 1 — chứng minh hiện tượng có thật trước, đừng đo tối ưu vội.** Tải cùng một URL hai lượt, trên hai tiến trình Chromium riêng biệt:

```
nguội (13 phút sau lượt trước) : 10703 ms
ấm    (ngay sau đó)            :  3595 ms
```

Trang **không đổi** giữa hai lượt, nên chênh lệch không phải do dữ liệu bị sinh lại sau khi gắn sản phẩm — đó là cache ấm theo thời gian, và nó sống **ngoài trình duyệt** (mỗi lượt là một Chromium mới). Chỉ sau khi biết điều này mới biết phép đo cần điều kiện gì.

**Bước 2 — dựng đúng điều kiện, kể cả khi phải chờ.** Trang lúc đó đang ấm vì chính bước 1, nên phải chờ 13 phút cho nguội hẳn rồi mới chạy job. Chạy sớm sẽ lặp lại đúng cái sai của phép đo cũ.

**Bước 3 — làm phép đo TỰ KIỂM CHỨNG.** Thêm số đo riêng `playwright-nap-truoc` cho lượt nạp trước. Nó cho biết trang lúc job bắt đầu là nguội hay ấm — thứ mà phép đo cũ không có cách nào biết, và đó chính là lý do nó sai mà không ai phát hiện. Kết quả 9,9 s khớp mức nguội 10,7 s → phép so sánh hợp lệ.

**Bước 4 — truy tác dụng phụ tới cùng.** Job đó đo `appium-tao-session` **76,2 s** (bình thường ~10 s), nghi Chromium tranh CPU. Nếu đúng thì prewarm lỗ nặng dù cắt 8,6 s. Đo riêng 2 cặp A/B: session một mình **9460 ms**, session + prewarm song song **9400 ms** — chênh **−60 ms**, tức nhiễu. **Không có tranh tài nguyên.** 76,2 s là một lần bất thường, xảy ra ở session Appium đầu tiên sau khi tiến trình API khởi động lại.

Nếu dừng ở bước 4 mà không đo, kết luận sẽ là "prewarm làm job chậm gấp đôi" — **sai ngược hoàn toàn**, và lần này sai theo hướng vứt bỏ một tối ưu đúng.

#### Lever 1 — `waitForIdleTimeout`: giảm chi phí mỗi lần đọc cây a11y

Đặt qua `driver.updateSettings({ waitForIdleTimeout })` **sau khi session đã dựng**, không phải capability — điểm này quan trọng: hai capability `skipDeviceInitialization`/`disableWindowAnimation` đã làm luồng chập chờn vì can thiệp vào bước khởi tạo thiết bị, còn setting thì không.

| | Trước | Sau |
|---|---|---|
| Chi phí mỗi lần `getPageSource` | ~500-590 ms | **~379-385 ms** |
| Tổng `a11y-tree` (dry-run) | 12,0 / 12,7 / 15,4 / 15,2 s | **11,0 / 11,0 / 11,1 s** |
| Job thật (session tái dùng) | 51,6 s | **48,1 s** |

**Phát hiện đáng giá hơn con số trung bình: độ dao động của `a11y-tree` sụp từ 3,4 s xuống 0,1 s.** Quãng "chờ app rảnh" chính là thành phần gây biến động lớn giữa các lần chạy giống hệt nhau — điều này giải thích luôn vì sao trước đây một phép đo đơn lẻ không phân biệt nổi thay đổi dưới ~4 s.

**Một chỗ CỐ Ý không dùng đường nhanh:** `selectMatchingProduct` khôi phục mức chờ đầy đủ (`readNodesReliably`) trước khi ĐẾM nút "Bỏ chọn sản phẩm". Ở mọi chỗ khác, đọc hụt chỉ làm một lượt chờ trượt rồi lượt sau bắt được; riêng ở đây đọc hụt cho ra một CON SỐ SAI mà code tin là đúng, và hậu quả là cú tap gỡ sản phẩm khỏi bộ sưu tập thật lọt qua chốt §4.7.

> ⚠️ Ước tính của tôi trước khi làm là **−12 s**, thực tế **−3,5 s**. Lần thứ NĂM liên tiếp một dự phóng tốc độ lạc quan quá mức. Sai ở chỗ lấy chênh lệch 193 ms (màn tĩnh) so với ~650 ms (trong job) rồi nhân với số lần gọi — nhưng ~650 ms là số của job *trước* khi các bước khác nhanh lên, và số lần gọi lại TĂNG (36 → 39) vì hỏi dày hơn.

#### Nhóm A — 48,1 s → 42,0 s (2026-08-17)

Ba mục độc lập, mỗi mục đều có dump/bằng chứng trước khi sửa. Job thật `15670265`, session tái dùng: **42,0 s**.

**A1. Chờ menu ngữ cảnh bằng `"Nút kéo"` thay vì OCR tìm "Chỉnh sửa"**

Menu ngữ cảnh chỉ có ĐÚNG MỘT nhãn a11y — `"Nút kéo"` (thanh kéo bottom sheet) — còn màn Mua sắm ngay trước đó không có nhãn này. Vắng mặt trước, có mặt sau: thoả §4.6 và tra được bằng cây.

Trước đây chỗ này `waitFor(['Chỉnh sửa'])` qua `find()`, tức mỗi lượt hỏi đều chụp ảnh + OCR ở nhịp 1500 ms. Phần OCR ở cú **tap** vẫn còn (bắt buộc, mục menu là canvas) — cái cắt được là phần **chờ**.

| | Trước | Sau |
|---|---|---|
| OCR | 2-3 lần / 2,0-4,2 s | **1 lần / 0,3-1,5 s** |
| Ảnh chụp | 3 lần / 2,5 s | **1-2 lần / 0,6-1,4 s** |

**A2. Bỏ OCR đọc tên sản phẩm khi ID bóc được thẳng từ URL** — **−2 s**

Tên sản phẩm chỉ còn dùng khi bước trích link không giải được ID. Dùng `parseProductRef` (thuần regex, không gọi mạng) ngay tại `selectMatchingProduct`: link đầy đủ → bỏ OCR; link RÚT GỌN trả null → vẫn OCR như cũ. Bỏ đúng chỗ thừa, giữ nguyên lưới an toàn ở nhánh cần nó. Khác cờ `AUTOMATION_SKIP_PRODUCT_OCR` ở chỗ cờ đó là tất-cả-hoặc-không.

**A3. Lượt tải lại đầu tiên ở `waitForProductOnPage` không còn bị phạt 4 giây** — **−2,6 đến −4 s**

Vòng chờ này ngủ trước rồi mới tải lại, nên nhịp 4000 ms cố định khiến mọi job vào nhánh này mất trọn 4 giây kể cả khi trang đã sẵn sàng. Lượt đầu hạ còn 1200 ms, các lượt sau giữ 4000 ms. Đo thật: `phase-3` **5,9 s** dù đã đi vào nhánh tải lại (trước: 8,5-10,1 s).

**Đã thử và bỏ trong nhóm A:** nâng quãng ngủ sau deep link 2500 → 4500 ms, kỳ vọng giảm số lượt của vòng chờ thẻ. Đo 3 lượt mỗi bên: tổng 47,7 s so với 47,1 s (nhiễu), nhưng `delay-cung` TĂNG 8,3 → 10,3 s và **số lượt hỏi không giảm** (11 → 10-11). Suy ra thời điểm thẻ sẵn sàng không phụ thuộc thời gian trôi từ deep link — nghi do lever 1 (`waitForIdleTimeout=100` trả về cây render dở nên phải hỏi nhiều lượt hơn). Đây là **tương tác giữa hai tối ưu**, ai muốn đụng vòng chờ này nên bắt đầu từ đó chứ đừng chỉnh con số ngủ.

#### Dải thẻ bộ sưu tập nằm DƯỚI màn hình — "ngoài tầm nhìn" ≠ "chưa render"

Phát hiện 2026-08-17, và nó sửa một lỗi tốn **~6 giây MỖI JOB** do chính đợt lever 2 tạo ra.

Bằng chứng (dump thật):

```
flow_01_shopping          : Di chuyển lên | Mua sắm | Tự động gắn thẻ…
flow_02_shopping_scrolled : … | 24/04 | SP 6M-8M | SP 5M-6M | SP 4M-5M | …
```

Thẻ bộ sưu tập **không phải chưa vẽ xong — chúng nằm ngoài màn hình đầu tiên**, bắt buộc phải cuộn mới thấy.

Lever 2 tách `openCollectionMenu` thành hai giai đoạn: "chờ render, tuyệt đối chưa cuộn" rồi mới "cuộn đi tìm", vì tưởng thẻ chỉ chưa render. Nhưng giai đoạn chờ đó **không bao giờ có thể thành công** — chờ bao lâu cũng vô ích khi thẻ ở ngoài màn. Nó đốt trọn 6 giây deadline ở mọi job rồi mới cuộn. Đó chính là `delay-cung` 11 lần / 8,3 s trong bảng chi phí.

→ **Đã sửa:** cuộn ngay khi lượt kiểm tra đầu (600 ms) không thấy, thay vì chờ 6 giây vô vọng.

| | Trước | Sau |
|---|---|---|
| `delay-cung` | 11 lần / 8,3 s | **4-6 lần / 3,8-4,4 s** |
| `mo-sheet-chinh-sua` (job thật) | 20,3 s | **15,6 s** |
| Dry-run trung bình | 47,7 s | **39,8 s** |

**Nhưng bản sửa đầu tiên làm 3/4 lượt hỏng ở bước 3** — và lý do đáng ghi riêng.

#### Toạ độ thẻ chỉ dùng được khi danh sách đã ĐỨNG YÊN

Bản sửa đầu cuộn xong là đọc toạ độ ngay. Danh sách còn trôi theo quán tính, nên toạ độ đọc được đã cũ vào lúc tap — cú tap rơi vào khoảng trống và menu ngữ cảnh không mở. Có lượt còn đọc thiếu thẻ (`"24/04", "SP 6M-8M"`) vì đọc giữa lúc đang trôi.

→ **Đã sửa:** đòi hỏi **hai lần đọc liên tiếp cho cùng một toạ độ y** trước khi tap. Đó là bằng chứng trực tiếp rằng danh sách đã dừng, thay vì đoán bằng một quãng ngủ cố định. Kiểm chứng **5/5 lượt dry-run** đạt bước 7 và lượt nào cũng đọc đủ 4 bộ sưu tập.

→ **Quy tắc:** trước khi tap theo toạ độ đọc từ cây a11y, phải chắc phần tử đã đứng yên. Đây là biến thể của §4.5 ("tap thành công ≠ có hiệu lực") ở phía NGƯỢC LẠI — không phải tap không ăn, mà là **toạ độ đã sai trước khi tap**.

#### Lever 2 — chờ cứng → chờ theo điều kiện: KHÔNG được gì về tốc độ

Đây là kết quả âm quan trọng, vì nó bác bỏ một niềm tin chạy suốt dự án ("chờ cứng là lãng phí, chờ theo điều kiện luôn tốt hơn").

Thay `delay(3000)` sau deep link bằng vòng chờ thẻ bộ sưu tập render:

| | Trước | Sau |
|---|---|---|
| Dry-run trung bình | 49,4 s | **50,3 s** rồi **50,1 s** |
| Ổn định | — | 5/5 rồi 4/4 |

**Không nhanh hơn, thậm chí hơi chậm hơn.** Lý do đo được: dải thẻ **thật sự cần ~3 giây để vẽ xong**, nên 3 giây đó quay lại nguyên vẹn dưới dạng các lượt hỏi — mà mỗi lượt hỏi còn tốn thêm một lần đọc cây a11y (~380 ms) trong khi một quãng ngủ thì không tốn gì.

→ **Bài học: chờ cứng không phải lúc nào cũng lãng phí.** Khi thời gian cần chờ ổn định và đã biết, **ngủ đúng chừng ấy RẺ HƠN hỏi liên tục**. Chờ theo điều kiện chỉ thắng khi thời gian chờ *biến động* hoặc *chưa biết*. Các lần chuyển đổi thành công ở đợt 2 (`waitForGone` sau "Đăng", chờ sheet chỉnh sửa) đều thuộc nhóm biến động — đó là lý do chúng thắng, không phải vì "chờ theo điều kiện tốt hơn".

#### Nhưng lever 2 lộ ra một lỗi tiềm ẩn có thật — đã sửa

Bỏ chờ cứng làm **1/3 lượt hỏng ở bước mở menu ngữ cảnh**. Truy ra: `openCollectionMenu` **cuộn ngay** khi lượt tìm thẻ đầu tiên không thấy gì. Lúc màn Mua sắm vừa mở mà chưa vẽ xong thì "không thấy" nghĩa là "chưa vẽ", không phải "nằm dưới màn" — cuộn lúc đó tự đẩy dải thẻ ra khỏi vùng nhìn và các bước sau tap trượt.

Lỗi này **đã nằm sẵn trong code từ trước**, chỉ không bao giờ nổ vì 3 giây chờ cứng che mất. Nay tách làm hai giai đoạn rõ ràng: **chờ render trước, cuộn sau**. Đây mới là giá trị thật của lever 2.

> Cùng mô-típ §4.8: **cắt thời gian khỏi một pipeline làm lộ ra thứ mà thời gian đó đang vô tình che.** Lần này che một lỗi thật sự chứ không chỉ một lớp đồng bộ.

#### Một comment nữa hoá ra SAI

`openShoppingScreen` ghi: *"nhãn 'Mua sắm' có mặt ở cả thanh điều hướng dưới nên waitFor có thể khớp trên màn cũ"* — **sai**. Dump hai đầu:

```
trước deep link : Tạo | Thông báo | Tài khoản
sau deep link   : Di chuyển lên | Mua sắm | Tự động gắn thẻ cho sản phẩm trong nội dung
```

Thanh điều hướng dưới KHÔNG chứa "Mua sắm". Quãng chờ 3 giây vẫn đáng giữ, nhưng vì lý do hoàn toàn khác (chờ thẻ render) — nay đã hạ còn 2500 ms và ghi đúng lý do.

#### Hai khẳng định cũ hoá ra SAI — đã đính chính trong code

1. **"Mục menu ngữ cảnh vốn có nhãn trong cây a11y nên chẳng tốn OCR."** Dump `flow_04_context_menu.xml` cho thấy cả menu chỉ có **đúng một** nhãn a11y là `"Nút kéo"`; "Chỉnh sửa" / "Chia sẻ" / "Xoá" đều vẽ canvas. Bước này **bắt buộc** tốn OCR và là khoản OCR duy nhất còn lại. Đừng tối ưu nó sang tree-only — sẽ không bao giờ khớp.
2. **"Dropdown Người bán không có dấu hiệu riêng nào để chờ."** Sai, và sai vì chỉ thử đúng MỘT nhãn ("Shopee") rồi suy ra là không còn nhãn nào. Diff hai dump thật cho thấy khi dropdown mở thì `"Người bán"` và `"Mở URL đến trang của người bán"` xuất hiện trong cây a11y, còn `"Xong"`/`"Chọn sản phẩm"` biến mất. Bài học: **"không tìm được dấu hiệu" chỉ là mệnh đề về nỗ lực tìm, không phải về sự tồn tại** — hãy diff dump hai trạng thái thay vì thử vài nhãn rồi kết luận.

#### Session Appium 10-15 s: không làm nó nhanh hơn, làm nó KHÔNG PHẢI CHẠY

Người dùng báo mỗi yêu cầu tốn 8-12 giây "đăng nhập và mở YouTube Studio". Đo ra thì hệ thống **không hề đăng nhập** (phiên Google lưu sẵn trên máy) — đó là `appium-tao-session`.

Đo tách bạch hai thành phần:

```
force-stop rồi deep link → màn Mua sắm : 3552 ms
app đã ở sẵn màn Mua sắm → deep link   :  432 ms
app còn sống nhưng ở màn khác          : 2693 ms
```

Nên app khởi động nguội chỉ chiếm ~3,1 s; phần lớn 8-12 s là dựng session. Ba việc đã làm:

**1. Không huỷ session khi lỗi ĐẦU VÀO** — trước đây mọi job hỏng đều huỷ session, kể cả khi hỏng vì link người dùng. Lúc đó điện thoại hoàn toàn khoẻ, mà job kế tiếp phải trả 10-15 giây dựng lại vì một lỗi chẳng liên quan tới nó. Đây chính là nguồn lớn nhất của quãng 8-12 giây khi đang thử nhiều link.

**2. Hâm nóng session lúc worker khởi động** (`warmUpAppiumSession`) — không giảm thời gian dựng, mà chuyển nó RA KHỎI đường chờ của người dùng. Gọi không `await` sau khi server listen, không bao giờ ném lỗi ra ngoài.

**3. Keepalive 15 phút** — `newCommandTimeout` là 3600 s, nhưng ở lưu lượng thấp khoảng nghỉ hơn 1 giờ là bình thường và session sẽ tự chết. Một lệnh `getWindowSize` mỗi 15 phút giữ nó sống vô hạn, biên an toàn gấp 4 lần.

**4. Bỏ `force-stop` khi kiểm chứng được app đang sạch** — không bỏ vô điều kiện: đọc cây a11y, phải thấy `"Mua sắm"` VÀ không thấy nhãn nào của sheet/menu (`"Nút kéo"`, `"Chỉnh sửa bộ sưu tập"`, `"Tìm sản phẩm"`…). Đọc không được, hoặc thấy bất kỳ dấu hiệu bẩn nào, đều force-stop như cũ. Đổi một lần đọc cây (~300 ms) lấy 3,1 giây.

**Kiểm chứng thật:** ba job liên tiếp **33,2 / 38,4 / 18,8 s**, log có `⚡ Dùng lại session` ở cả ba và `⚡ App đang ở màn Mua sắm sạch — bỏ qua force-stop`.

#### Lỗi tôi tự tạo ra khi làm việc này: deadlock tự chờ chính mình

Bản đầu đặt khoá `dangDungSession` **bao quanh** lời gọi `init()` trong `warmUpAppiumSession`, mà bên trong `init()` lại có `await dangDungSession` — nó chờ chính thao tác đang bao quanh nó. Job đứng im vĩnh viễn ở `processing`, **không log thêm dòng nào**, và chỉ lộ ra khi nhìn vào DB.

→ **Quy tắc: khoá phải đặt BÊN TRONG đoạn cần bảo vệ, không bao quanh cả lời gọi.** Khoá bao quanh một hàm mà chính hàm đó cũng chờ khoá là công thức deadlock.

→ **Dấu hiệu nhận biết:** job `processing` mà log im lặng hoàn toàn — khác hẳn job chậm (vẫn in từng bước) hay job hỏng (có dòng lỗi).

#### `readNodesReliably` — bỏ "chờ app rảnh 10 giây", đổi sang "chờ danh sách đứng yên"

Người dùng báo màn hình đứng hình lâu giữa bước chọn Shopee và bước bấm "Xong". Truy ra: `readNodesReliably` đặt `waitForIdleTimeout = 10000` rồi đọc một lần — ngay sau khi áp bộ lọc, app đang tải kết quả nên UiAutomator2 chờ tới **10 giây** cho app rảnh.

Đo được sự biến động đó trong các job cũ: `tap-xong` (lúc đó còn gộp cả bước chọn sản phẩm) dao động **3,8 s → 9,8 s** giữa các job giống hệt nhau.

→ **Đã sửa:** `SAFE_IDLE_MS` 10000 → 1500, và việc "chờ render xong" chuyển sang **so hai lần đọc liên tiếp cho cùng một vân tay danh sách** — cùng kỹ thuật đã dùng cho dải thẻ bộ sưu tập.

Cách mới **chặt hơn chứ không chỉ nhanh hơn**: "app rảnh trong X ms" là bằng chứng gián tiếp và sai được cả hai chiều — app bận vì lý do khác thì ta chờ oan, app rảnh giữa hai đợt render thì ta đọc phải danh sách dở dang. Hai lần đọc giống nhau là bằng chứng trực tiếp.

**Cũng đã thêm mốc đo riêng `chon-san-pham`** — trước đây bước này là bước DUY NHẤT trong luồng không có mốc, nên thời gian của nó bị gộp vào `tap-xong` và chính điều đó che mất quãng đứng hình 10 giây suốt nhiều đợt đo.

| | Trước | Sau |
|---|---|---|
| `chon-san-pham` | (không đo được) | **3,4 s** |
| `tap-xong` | 3,8-9,8 s (gộp cả hai) | **0,6 s** |

#### B2 — `ignoreUnimportantViews`: cây a11y nhỏ đi 4,5 lần

Setting (không phải capability), bật cùng `waitForIdleTimeout` trong `setIdleWait()`.

| Đo ở màn kết quả tìm sản phẩm | TẮT | BẬT |
|---|---|---|
| `getPageSource` | 331 ms | **115 ms** |
| Kích cỡ XML | 59 KB | **13 KB** |
| Số nhãn | 22 | 9 |

**13 nhãn biến mất đều thuộc màn hình NỀN phía sau sheet** (`24/04`, `SP 6M-8M`, `Mua sắm`, `Tạo bộ sưu tập`…) — chính phần rác rò vào cây.

**Nhưng "vắng ở màn A" không kết luận được cho màn B** — đúng loại suy luận mà dự án này đã sai nhiều lần. Nên đã kiểm **từng màn trong cả 7 màn của luồng**, và mọi màn giữ đủ nhãn của chính nó:

```
dải thẻ bộ sưu tập  11 → 11 nhãn   còn nguyên "24/04", "SP 6M-8M"…
menu ngữ cảnh        1 →  1 nhãn   còn "Nút kéo"
kết quả đã lọc      21 →  8 nhãn   còn "Chọn sản phẩm", "Bỏ chọn sản phẩm",
                                   "Xoá người bán đã chọn"
```

Nhãn `"Bỏ chọn sản phẩm"` — thứ nuôi chốt §4.7 — được **kiểm riêng** bằng một link sản phẩm ĐÃ nằm trong bộ sưu tập, vì nó chỉ xuất hiện trong tình huống đó. Kết quả: vẫn còn khi bật cờ.

Dù vậy `readNodesReliably` (đường đọc cho chốt §4.7) vẫn **TẮT cờ**: một lần đọc đầy đủ mỗi job là cái giá rẻ để lớp bảo vệ quan trọng nhất không phụ thuộc vào một cờ tối ưu, kể cả khi app đổi cách đánh dấu view sau này.

**Kết quả trong job thật:** `a11y-tree` **14,1 s → 11,4 s** (381 → 308 ms/lần). Nhưng tổng job chỉ **40,2 → 39,6 s**.

#### Quy tắc: cắt được thành phần ĐO ĐƯỢC không có nghĩa cắt được TỔNG

Mô-típ này đã lặp đủ nhiều lần để thành quy tắc. Cùng job, trước và sau B2:

```
trước: các khoản đo được 26,3 s + phần dư 13,9 s = 40,2 s
sau  : các khoản đo được 23,1 s + phần dư 16,5 s = 39,6 s
```

Cắt 3,2 s khỏi phần đo được thì **phần dư phình ra 2,6 s**. Phần dư là thời gian app YouTube Studio phản hồi thao tác — nó không biến mất khi ta đọc cây nhanh hơn, nó chỉ chuyển từ "nằm trong lần đọc của ta" sang "nằm giữa hai lần đọc".

Đã gặp đúng hiện tượng này ở lever 1 (dự −12 s, thực −3,5 s) và ở dự phóng 42 s (thực 51,6 s). **Hệ quả thực tiễn: mọi ước tính kiểu "cắt X giây khỏi khoản này thì job nhanh hơn X giây" đều SAI ở dự án này.** Chỉ chạy job rồi đọc tổng mới biết.

#### Đã thử và BỎ — lọc "Người bán" TRƯỚC khi gõ link (mục B1)

Ý tưởng rất hợp lý nên ghi kỹ để không ai làm lại. Luồng hiện tại tưởng như tốn hai vòng gọi mạng:

```
dan-link-va-tim      ~7,4 s   gõ link → Enter → kết quả THÔ (chưa lọc)
loc-nguoi-ban-shopee ~2,3 s   áp bộ lọc → app truy vấn LẠI
```

Dò thật cho thấy **về mặt cơ chế thì làm được**:

| Câu hỏi | Kết quả |
|---|---|
| Chip "Người bán" bấm được khi ô tìm TRỐNG? | ✅ CÓ |
| Chọn Shopee áp được bộ lọc? | ✅ CÓ (`Xoá người bán đã chọn` xuất hiện) |
| Bộ lọc sống sót qua gõ + Enter? | ✅ CÓ |
| Gõ → kết quả ổn định | 4,14 s |

Nhưng **đo trong luồng thật thì TỆ HƠN**:

| | Thứ tự cũ | Lọc trước |
|---|---|---|
| `loc-nguoi-ban-shopee` | 2,3 s | **4,1 s** |
| `dan-link-va-tim` | 7,4 s | 7,2 s |
| **Cộng** | **9,7 s** | **11,3 s** |

→ **Lý do:** áp bộ lọc khi ô tìm còn TRỐNG tự nó kích hoạt một truy vấn mạng để hiện danh sách sản phẩm Shopee mặc định. Vòng mạng không biến mất, nó chỉ đổi chỗ — và còn đắt thêm 1,6 s.

→ **Vì sao probe cho 4,14 s mà thực tế không tiết kiệm:** probe chỉ bấm giờ từ lúc GÕ, nên không tính chi phí áp bộ lọc trên ô trống. Đây là biến thể của cùng một sai lầm đo đạc lặp lại suốt dự án: **đo một đoạn rồi suy ra cả tổng.**

→ Một hệ quả phụ đáng nhớ: khi lọc trước, nhãn `"Chọn sản phẩm"` CÓ MẶT từ trước lúc gõ (app hiện sẵn sản phẩm mặc định), nên `waitFor(['Chọn sản phẩm'])` sau khi Enter trở thành dấu hiệu rỗng — đúng bẫy §4.6. Điều kiện "nhãn này vắng mặt trước khi bấm Enter" **chỉ đúng với thứ tự hiện tại**. Ai định đảo thứ tự phải thay dấu hiệu chờ (đã thử: vân tay toạ độ danh sách, đổi rồi đứng yên — hoạt động được).

#### Đã thử và BỎ — đợt 3

- **Deep link mở thẳng vào bộ sưu tập (bỏ qua bước điều hướng 20-33 s)** — ❌ **KHÔNG TỒN TẠI.** Đây từng là đòn bẩy duy nhất đủ lớn để chạm mục tiêu 25-30 s, nên kết quả âm này đóng lại câu hỏi đó.

  Cơ sở để hy vọng: `dumpsys package` cho thấy intent filter của app là **wildcard trên `studio.youtube.com`, không giới hạn path** — mọi đường dẫn đều được giao cho MainActivity và app tự định tuyến.

  Nhưng dò thật (`src/scripts/probeDeepLinks.ts`) cho thấy app **bỏ qua hoàn toàn mọi đoạn path sau `/monetization/shopping`**:

  ```
  ĐỐI CHỨNG  /shopping/khong-ton-tai-xyz123   → 3 nhãn
  MỐC        /shopping                        → 3 nhãn Y HỆT đối chứng
  /shopping/collections                       → khác đối chứng 0 nhãn
  /shopping/collection/<id>                   → khác 0 nhãn
  /shopping/collections/<id>                  → khác 0 nhãn
  /shopping?collection=<id>                   → khác 0 nhãn
  /shopcollection/<id>                        → rơi ra Chrome
  /channel/<ch>/shopcollection/<id>           → rơi ra Chrome, web báo "không có quyền xem trang này"
  ```

  **Nhóm đối chứng là thứ làm kết quả này dùng được.** App nhận MỌI path nên URL bịa cũng "mở được" — nếu chỉ hỏi "app có mở không" thì ứng viên nào cũng có vẻ thành công. Phải so với một path chắc chắn vô nghĩa mới biết đâu là "app hiểu" và đâu là "app rơi về màn mặc định". Và hai ứng viên cuối rơi ra Chrome chứng minh phép thử ĐỦ NHẠY để thấy khác biệt khi có.

  → **Hệ quả: 20-33 giây điều hướng qua giao diện là chi phí bắt buộc.** Đường duy nhất còn lại để xuống 25-30 s là **gộp nhiều sản phẩm trong một phiên**, tức đổi mô hình sản phẩm chứ không phải tối ưu kỹ thuật.

- **`skipDeviceInitialization` + `disableWindowAnimation` để tạo session nhanh hơn** — ❌ **GỠ BỎ vì làm luồng chập chờn.**

  Đo cô lập (chỉ tạo/huỷ session, 2 lượt mỗi biến thể) rất hấp dẫn:

  ```
  hiện tại                        9032 ms
  + skipServerInstallation        8790 ms   ← nhiễu, bỏ
  + skipDeviceInitialization      5467 ms   ← khoản lớn
  + disableWindowAnimation        4408 ms
  ```

  Nhưng chạy luồng thật thì sinh ra **hai kiểu lỗi chưa từng thấy**, đều ở các bước không liên quan tới session:

  ```
  [chon-chinh-sua] tap 3 lần mà sheet không mở
       → a11y 52 lần/22,6 s, chờ vòng lặp 41 lần/16,8 s — bão retry, job 65,3 s
  [cho-ket-qua-tim-kiem-tho] chờ 20 s không thấy kết quả tìm kiếm
  ```

  Giả thuyết: `skipDeviceInitialization` bỏ đúng bước Appium cài và cấu hình app trợ giúp `io.appium.settings`, mà `disableWindowAnimation` lại phải nhờ chính app đó. Hai cờ đánh nhau.

  **Kiểm chứng sau khi gỡ: 4/4 lượt dry-run liên tiếp đều chạy tới bước 7.** Trước khi gỡ, 6 lượt có 2 lỗi mới.

  → **Bài học, và là lần thứ N của dự án này: đo cô lập một thao tác KHÔNG chứng minh được nó an toàn trong luồng thật.** Muốn thử lại thì bật TỪNG cờ một, mỗi lần đòi hỏi **5/5 lượt dry-run thành công**, chứ đừng chỉ đo thời gian.

- **`newCommandTimeout` 300 s → 3600 s** — ✅ giữ. Không phải tối ưu tốc độ mà là sửa một giả định sai: cơ chế tái dùng session chỉ có tác dụng khi job sau tới TRƯỚC lúc Appium tự đóng session. Ở mức 300 s, mọi job cách nhau quá 5 phút đều phải dựng lại — tức gần như mọi job ở lưu lượng hiện nay. Phần tiết kiệm ~10 s/job đó đúng trên giấy nhưng gần như chưa từng xảy ra. An toàn vì `init()` luôn kiểm tra session còn sống trước khi dùng lại.

- **Thay `getPageSource()` bằng `UiSelector().descriptionContains(...).isExisting()`**: kỳ vọng hỏi "nhãn X có không" rẻ hơn dump cả cây. Đo thật 5 lượt mỗi loại trên màn hình đứng yên: `getPageSource` **193 ms**, UiSelector khi **khớp** 224 ms, khi **không khớp 398 ms**. Mà đường "không khớp" mới là đường vòng chờ đi mỗi lượt → **chậm hơn gấp đôi**. Bỏ.
- Phép đo trên còn cho một kết luận quan trọng hơn: `getPageSource` tốn **193 ms** lúc màn hình đứng yên nhưng **~527 ms** trong job thật. Chênh lệch đó là **thời gian app render**, không phải chi phí dump XML. Nghĩa là phần lớn 17,4 s của `a11y-tree` là thời gian thật của app, **hỏi ít đi không lấy lại được**.

#### Vì sao 25-30 s không khả thi — ngân sách từ số đo thật

Job thật `f925e175` sau tối ưu: **61,3 s**.

| Khoản | Hiện tại | Sàn | Ghi chú |
|---|---|---|---|
| `a11y-tree` (33 lần) | 17,4 s | ~15 s | phần lớn là app render, không cắt được |
| ~~`playwright-tai-trang`~~ | ~~11,0 s~~ → **2,4 s** | 2,4 s | ✅ **đã cắt −8,6 s** bằng prewarm |
| `appium-tao-session` | 10,4 s | 0 | tái dùng session giữa các job thành công |
| Chờ cứng | 5,4 s | ~4 s | 3 s sau deep link phải giữ (§8) |
| `cho-vong-lap` | 3,7 s | ~3 s | |
| OCR | 2,2 s | 2,2 s | menu ngữ cảnh, bắt buộc |
| Ảnh chụp | 2,0 s | 2,0 s | |
| Tap + gõ + app phản hồi | ~9 s | ~9 s | 9 thao tác trên máy thật |
| **Tổng** | **61,3 s** → **~52,7 s** sau prewarm | **~39 s** | |

**Sàn thực tế ≈ 39-44 s**, và đó là đã bỏ `humanDelay`. Sau prewarm, phần chưa hiện thực hoá chỉ còn đúng một khoản: `appium-tao-session` 10,4 s → 0 khi các job thành công chạy liên tiếp (cơ chế đã có sẵn). Muốn xuống 25-30 s thì phải cắt tiếp vào `a11y-tree` và thời gian app phản hồi — cả hai là thời gian của app YouTube Studio, không phải của code ta. Đường duy nhất còn lại là **giảm số bước trong luồng**, tức đổi cách làm chứ không phải tối ưu chỗ hiện có.

**Lần thứ ba liên tiếp mục tiêu tốc độ bị ước lượng lạc quan** (đợt 1 dự 35 s đạt 10,6 s; đợt 2 dự 25-30 s đạt 68,7 s; đợt 3 nhắm 25-30 s đạt 63,2 s). Mô-típ đủ rõ để rút thành quy tắc: **dựng bảng ngân sách từ số đo TRƯỚC khi nhận mục tiêu, và trừ ngay phần thời gian thuộc về app chứ không thuộc về mình.**

#### Còn lại — nhắm vào hai khoản lớn nhất còn sót

Theo bảng chi phí job thật, sau session thì hai khoản đầu bảng là:

- [x] ~~**Số lần gọi `getPageSource`**~~ — đã xử lý qua hai vòng: `waitForIdleTimeout` (lever 1) và `ignoreUnimportantViews` (B2). Chi phí mỗi lần **~520-650 ms → ~308 ms**. Số LẦN gọi không giảm được (37 lần) vì phần lớn là vòng chờ hợp lệ.
- [x] ~~**OCR còn lại**~~ — còn **1 lần / 0,3-0,6 s** mỗi job. Cắt bằng ba việc: dump `flow_06_add_product.xml` mở khoá tree-only cho `mo-them-san-pham`, nhãn `"Nút kéo"` thay OCR ở bước chờ menu ngữ cảnh (A1), và bỏ OCR đọc tên sản phẩm khi ID bóc được thẳng từ URL (A2). Lần OCR duy nhất còn lại là cú **tap** vào "Chỉnh sửa" — bắt buộc, vì mục menu vẽ canvas.

**Danh sách tối ưu có bằng chứng đã CẠN.** Ngân sách 39,6 s còn lại: `a11y-tree` 11,4 s (đã vắt hai vòng), phần dư ~16,5 s là thời gian app phản hồi, `phase-3` ~9 s phụ thuộc YouTube cập nhật trang. Mọi thứ còn lại đều là thời gian của app YouTube Studio chứ không phải của code này — và quy tắc "cắt được thành phần đo được ≠ cắt được tổng" ở trên nói rõ vì sao cắt tiếp cũng không ăn thua.

**Không cắt `humanDelay` ngẫu nhiên** — đó là chi phí có chủ đích để tránh nhịp máy móc bị phát hiện là bot. Đo được 8-10 lần/job, ~9-14 s. Muốn xuống dưới ~55 s/job thì đây là nguồn duy nhất còn lại, và đó là **quyết định đánh đổi rủi ro tài khoản, không phải quyết định kỹ thuật** — chỉ có một tài khoản đủ điều kiện, mất là dừng cả hệ thống.

**Bài học về ước lượng, hai đợt liên tiếp:**
- Đợt 1: dự đoán ~35 s, đạt ~10,6 s.
- Đợt 2: dự đoán về đích 25-30 s, đạt 68,7 s. Sai lầm cụ thể: ước lượng Phase 1 khoảng 20 s trong khi đo thật là ~51 s, vì tính mỗi cú tap ~2,2 s mà thực tế đắt hơn nhiều.

Cả hai đợt đều ước lượng lạc quan gấp 2-3 lần. **Đo trước khi sửa, đo lại sau khi sửa, và đừng hứa con số trước khi có bảng chi phí.**

---

## 9. Chạy dự án (môi trường dev)

```bash
# 1. Hạ tầng (Postgres cổng 5433 vì máy đã có Postgres native chiếm 5432)
docker compose up -d postgres redis

# 2. Appium (cần Node 22+, Appium 3.x, driver uiautomator2 8.x)
npx appium --port 4723

# 3. Kiểm tra thiết bị Android
cd packages/api && npm run check-adb

# 4. API + worker (chạy TRÊN HOST, không trong container —
#    vì worker cần gọi adb/Appium tới thiết bị)
npm run dev
```

**Lưu ý:** container `affiliate_api` trong docker-compose **không dùng được** cho worker vì không với tới thiết bị Android qua USB. Từ 2026-08-19 nó nằm sau `profiles: ["docker-only"]` và `restart: "no"`, nên `docker compose up -d` KHÔNG khởi động nó và Docker Desktop không tự bật lại. (Trước đó dòng này ghi "đã tắt auto-restart" nhưng file vẫn là `restart: unless-stopped` — xem nợ kỹ thuật 7.9.)

### App mobile (`packages/mobile`)

```bash
cd packages/mobile && npm start   # quét QR bằng Expo Go
```

- Địa chỉ API đặt trong `packages/mobile/.env` (`EXPO_PUBLIC_API_URL`). **Phải là IP LAN của máy chủ**, không dùng `localhost` — trên điện thoại `localhost` trỏ về chính điện thoại. Sửa xong phải **reload hẳn app**, restart Metro không đủ.
- **Không cài Expo Go lên chiếc điện thoại đang cắm USB làm automation** — Appium đang điều khiển màn hình máy đó. Cần máy thứ hai để thử.
- Windows Firewall thường chặn cổng 3000 từ điện thoại vào; đây là nghi phạm đầu tiên khi app báo không kết nối được.
- App **không hiển thị tên/ảnh sản phẩm** dù API có trả, vì `services/shopee.ts` còn là mock (trả tên sản phẩm ngẫu nhiên từ mảng cứng). Xem §10.7.

#### Kiểm thử giao diện không cần điện thoại thứ hai

Chạy app trên trình duyệt, đấu với API ở chế độ giả lập — job xong trong ~4 giây, **không đụng điện thoại, không gắn gì lên kênh**:

```bash
# 1. Bổ sung hỗ trợ web (chỉ cần làm một lần)
cd packages/mobile && npx expo install react-native-web react-dom @expo/metro-runtime

# 2. API ở chế độ giả lập — đặt biến ở shell, KHÔNG sửa .env
#    (dotenv không ghi đè biến đã có nên biến shell luôn thắng)
cd packages/api
$env:AUTOMATION_MODE='simulation'; npm run dev     # PowerShell

# 3. Bản web
cd packages/mobile && npx expo start --web --port 8081
```

Có thể lái tự động bằng Playwright (đã có sẵn trong `packages/api`) để chụp từng trạng thái.

**Hai cạm bẫy:**
- Nhớ **tắt Appium server** khi test ở chế độ giả lập. Nếu biến môi trường không ăn, job sẽ chạy thật và gắn sản phẩm lên kênh; không có Appium thì nó hỏng vô hại.
- **Trả API về chế độ appium sau khi test xong.** Để kẹt ở giả lập sẽ trả link `affiliate_sim_...` giả mà nhìn như thật.

Lần chạy đầu sau khi Metro bundle xong, luồng JS bị nghẽn vài giây nên giao diện có vẻ "đơ" — đó là đặc tính của dev bundle, không phải lỗi app. Đo thật: màn lỗi hiện sau **110 ms** khi bundle đã ấm.

#### Demo JOB THẬT trên bản web (2026-08-17)

Khác mục trên: đây là chạy **thật**, có gắn sản phẩm lên kênh.

```bash
# API + worker ở chế độ appium (mặc định), Appium server và điện thoại đã sẵn sàng
cd packages/api && npm run dev

# Bản web
cd packages/mobile && npm run web        # → http://localhost:8081
```

Ba việc nên làm trước khi demo, rút từ lần chạy thật:

1. **Làm ấm bundle trước** bằng cách tự mở trang một lần. Metro biên dịch 1,65 MB mất ~16 s ở lần đầu; không làm thì người xem tưởng app treo.
2. **Kiểm tra bộ sưu tập đang có gì** (`dumpCollectionLinks.ts`) rồi mới chọn link. Link trùng sẽ bị chốt §4.7 chặn — đúng thiết kế nhưng trông như lỗi khi đang demo.
3. **Danh sách link phải soạn lại ngay trước khi chạy.** Lần đo 5 job vừa rồi hỏng job đầu đúng vì danh sách soạn trước đó vài phút đã lạc hậu — chính job thử nghiệm chạy xen giữa đã thêm sản phẩm đó vào bộ sưu tập.

Đo thật qua giao diện: **40,2 / 40,3 / 50,3 s** tính từ lúc bấm nút (số của 2026-08-17). Chênh ~3 s so với thời gian xử lý trong DB là độ trễ polling — **đã giảm còn ~1 s từ 2026-08-19**, xem mục "Độ trễ do polling của giao diện" ở §6.

### Script hữu ích

| Lệnh | Công dụng |
|---|---|
| `npm run check-adb` | Kiểm tra thiết bị, phiên bản Android, app đã cài |
| `ts-node src/scripts/dumpCurrent.ts <tên>` | Dump cây UI màn hình đang mở |
| `ts-node src/scripts/exploreFlow.ts` | Chạy luồng tới trước bước thay đổi dữ liệu (an toàn) |
| `DRY_RUN=1 ts-node src/scripts/testMobileCollectionTagging.ts` | Chạy hết luồng nhưng **không bấm "Đăng"** |
| `ts-node src/scripts/testShareLink.ts` | Chỉ chạy Phase 2 (không gắn thêm sản phẩm) |
| `ts-node src/scripts/testAffiliateLink.ts "<url>"` | Chẩn đoán link affiliate, theo dõi chuyển hướng |
| `ts-node src/scripts/checkShopeeLinkMatching.ts` | **Không cần điện thoại.** Kiểm tra logic bóc ID sản phẩm, gồm cả các ca âm tính (cùng productId khác seller phải KHÔNG khớp) |
| `ts-node src/scripts/checkWrongProductGuard.ts "<link bst>"` | **Không cần điện thoại.** Hồi quy cho lỗi §4.8: ID vắng mặt + tên mồi nhử trùng sản phẩm thật → phải TỪ CHỐI |
| `ts-node src/scripts/dumpCollectionLinks.ts "<link bst>"` | Liệt kê mọi link Shopee trên trang bộ sưu tập kèm ID bóc được — cách nhanh nhất để biết sản phẩm đã lên trang chưa |
| `ts-node src/scripts/checkSessionDisposal.ts` | **Không cần điện thoại.** Hồi quy cho luật huỷ session (§4.14): lỗi giao diện phải GIỮ session, lỗi kênh điều khiển phải HUỶ, và van an toàn phải bật từ lần thử ≥ 2 |
| `ts-node src/scripts/reportJobPhases.ts <file log>` | Bóc bảng chi phí của TỪNG lượt chạy ra khỏi log rồi so sánh cạnh nhau — bước, mốc tích luỹ, loại thao tác, và phần dư. Dùng khi cần so nhiều job, vì bảng in sẵn chỉ cho từng job một |
| `ts-node src/scripts/checkCollectionExtractor.ts "<link bst>"` | **Không cần điện thoại.** Hồi quy cho bộ trích link Phase 3 (§4.13): tự lấy mốc chuẩn từ chính trang, đòi mỗi sản phẩm trích ra đúng link của mình, kèm một ca âm tính có tên mồi nhử. Chạy sau MỌI thay đổi đụng tới cách đọc trang |
| `ts-node src/scripts/probeDeepLinks.ts` | Dò xem có deep link nào mở sâu hơn màn Mua sắm không. Đã chạy 2026-08-17: **không có**. Giữ lại vì có nhóm đối chứng đúng cách — dùng lại được khi app đổi phiên bản |

**Năm script `check*` chạy được mà không cần thiết bị** — nên chạy sau mỗi lần sửa luồng trích link, trước khi động tới điện thoại. `checkCollectionExtractor` là cái DUY NHẤT thật sự tải trang thật rồi đối chiếu; ba cái kia đều có thể xanh trong khi bộ trích hỏng hẳn (§4.13).

### Biến môi trường quan trọng

```
AUTOMATION_MODE=appium          # hoặc simulation khi không có thiết bị
ADB_PATH=C:\platform-tools\platform-tools\adb.exe
APPIUM_HOST=127.0.0.1
APPIUM_PORT=4723
ANDROID_DEVICE_SERIAL=          # trống = thiết bị đầu tiên
YT_CHANNEL_ID=UC3fFeHphb3dQtKcr0RdAOmA
YT_COLLECTION_NAME=             # trống = bộ sưu tập đầu tiên
RESULT_TTL_SECONDS=2700         # hạn giữ link trong Redis

# — Thêm 2026-08-16 —
APPIUM_REUSE_SESSION=1          # giữ session giữa các job, tiết kiệm ~13 s. 0 để tắt khi gỡ rối
AUTOMATION_CHECKPOINT_SHOTS=0   # ảnh mốc đường thành công. DRY_RUN=1 tự bật; 0 tắt tường minh khi đo
AUTOMATION_SKIP_PRODUCT_OCR=0   # bỏ OCR đọc tên sản phẩm (~2,6 s). Xem cảnh báo dưới

# — Thêm 2026-08-17 —
AUTOMATION_HUMAN_DELAY=0        # nhịp ngẫu nhiên chống nhận diện bot. TẮT mặc định — xem dưới
```

**Về `AUTOMATION_SKIP_PRODUCT_OCR`:** sau khi sửa §4.8, tên sản phẩm chỉ còn dùng khi **không giải được ID** từ link đầu vào (đã kiểm chứng: job chạy đúng với `PRODUCT_NAME` rỗng). Nhưng link rút gọn cần một lần gọi mạng để giải, và lần đó có thể hỏng — khi ấy tên sản phẩm là thứ duy nhất còn lại. Vì vậy vẫn để tắt: nó đổi 2,6 giây lấy việc bỏ đi lưới an toàn cho một nhánh hiếm nhưng có thật.

**Về `AUTOMATION_HUMAN_DELAY`:** tắt mặc định từ 2026-08-17 theo quyết định của chủ dự án, đổi 9,5 giây/job lấy việc bỏ nhịp ngẫu nhiên giữa các thao tác. Đây là **quyết định rủi ro tài khoản**, không phải tối ưu kỹ thuật: hệ thống có đúng một tài khoản đủ điều kiện, mất là dừng toàn bộ (§10.1, §10.2). **Bật lại ngay (`=1`) nếu thấy bất kỳ dấu hiệu nào sau đây:** captcha xuất hiện trong app, Google đòi xác minh thiết bị, thao tác bị chặn hoặc chậm bất thường, cảnh báo hoạt động đáng ngờ trong tài khoản.

**Về `YT_COLLECTION_NAME`:** nên **đặt tường minh**. Bỏ trống thì automation dùng "thẻ đầu tiên trên màn Mua sắm" — tên đó chỉ biết sau khi Phase 1 chạy xong, nên không tra được cache link chia sẻ từ trước.

---

## 10. Những điều cần chú ý khi phát triển tiếp

### 10.1. Rủi ro nền tảng (quan trọng nhất)

Automation trên giao diện không phải API chính thức thường vi phạm điều khoản dịch vụ, có thể dẫn đến khoá tài khoản. **Mở rộng lên nhiều tài khoản nhân lên rủi ro chứ không chỉ nhân công suất.** Cần đánh giá kỹ trước khi đầu tư xây dàn thiết bị, và có phương án dự phòng.

### 10.2. Throughput là giới hạn cứng

Không thể tối ưu code để vượt qua giới hạn 1 tài khoản. Toàn bộ kỳ vọng UX, SLA phải thiết kế dựa trên giới hạn này.

### 10.3. Độ ổn định phụ thuộc giao diện bên thứ ba

YouTube đổi giao diện là automation gãy ngay, không báo trước. Cần job test định kỳ, không chờ người dùng phàn nàn.

### 10.4. Quản lý đăng nhập

**Không tự động hoá bước đăng nhập** — dễ bị Google đánh dấu bất thường, kích hoạt captcha/xác minh thiết bị. Đăng nhập thủ công một lần, giữ session. Với máy ảo: đăng nhập một lần rồi giữ dữ liệu AVD (hoặc snapshot).

### 10.5. Nhịp độ thao tác tự nhiên

Giữ độ trễ ngẫu nhiên giữa các thao tác (`humanDelay`). Tối ưu tốc độ chỉ nên nhắm vào *thời gian chết*, không phải thao tác nhanh bất thường.

### 10.6. Minh bạch về thời gian chờ

Hệ thống không real-time. Phải truyền đạt rõ thời gian chờ ước tính, và **con số đó phải đúng** (xem nợ kỹ thuật 7.2).

### 10.7. Không bịa dữ liệu

Đã có **năm** lỗi loại này, và loại này là loại nguy hiểm nhất của dự án:

1. Sinh mã voucher ngẫu nhiên khi không tìm thấy.
2. Lấy đại link Shopee đầu tiên khi không khớp sản phẩm.
3. **So tên khớp 57% rồi trả link của sản phẩm khác** (2026-08-16, §4.8) — đã sửa.
4. **`services/shopee.ts` bịa tên sản phẩm suốt nhiều tuần** — đã gỡ 2026-08-16. Chưa ai thấy chỉ vì app mobile không hiển thị trường đó; nghĩa là nó có thể đã sống thêm rất lâu nữa nếu không tình cờ đọc phải một phản hồi API trong lúc gỡ lỗi việc khác.

5. **`extractVoucherFromText()` bịa mã voucher từ mã JS của trang** (2026-08-19). Hàm này quét trang bằng những mẫu rất lỏng — `/code[:\s]*([A-Z0-9]{4,20})/i`, `/mã[:\s]*.../i`. Hồi Phase 3 còn Playwright, nó soi `innerText` nên tương đối vô hại. Khi Phase 3 chuyển sang `fetch`, cùng hàm đó bắt đầu soi **HTML thô 780 KB kèm toàn bộ script**, và job `226149c6` trả về người dùng:

   ```
   "voucher": "URICOMPONENT"      ← bóc ra từ chữ decodeURIComponent trong script
   ```

   Đã gỡ hẳn hàm. Chỉ giữ `extractVoucherFromUrl` — đọc tham số truy vấn CÓ TÊN nên không đoán bậy được. §1.1 vốn đã chốt là **không tồn tại mã voucher rời**, nên mọi phép dò theo văn bản chỉ có hai kết cục: rỗng, hoặc rác.

Cả năm đều đã sửa. Nhưng lưu ý điều số 4 và số 5: **dữ liệu bịa nằm im không gây triệu chứng gì cho tới lúc có người đọc nó.** Đừng dựa vào việc "chưa ai phàn nàn" để kết luận là không có.

Điều số 5 còn thêm một bài học riêng: **một hàm không đổi dòng nào vẫn có thể hoá độc khi ĐẦU VÀO của nó đổi.** `extractVoucherFromText` y nguyên suốt nhiều tháng; thứ thay đổi là thứ được truyền vào nó — từ `innerText` (chỉ chữ người dùng thấy) sang HTML thô (kèm mã nguồn JS). Khi thay đổi nguồn dữ liệu, phải rà lại **mọi hàm tiêu thụ nguồn đó**, chứ không chỉ đoạn code vừa sửa.

**Thà báo lỗi còn hơn trả dữ liệu sai** — người dùng nhận nhầm link sản phẩm là hỏng niềm tin.

Hai điều rút ra từ lần thứ ba, vì nó khác ba lần kia:

- **Đường lui "gần đúng" nguy hiểm hơn không có đường lui.** Ngưỡng tương đồng nghe có vẻ an toàn, nhưng hai listing của cùng một mẫu sản phẩm luôn vượt ngưỡng của nhau. Khi đã có một dấu hiệu chính xác tuyệt đối (ID sản phẩm) thì **không được phép lui về dấu hiệu mờ** — thà chờ, rồi báo lỗi.
- **Dấu hiệu đúng đã làm đúng việc; thứ phá hoại là đường lui.** So khớp theo ID đã từ chối chính xác. Nếu lúc đó dừng lại thì job chỉ đơn giản là thất bại. Đường lui biến một thất bại lành thành một câu trả lời sai.

### 10.8. Pháp lý và uỷ quyền

Nếu mở rộng sang mô hình nhiều tài khoản/cộng tác viên: làm rõ uỷ quyền truy cập tài khoản, bảo mật thông tin đăng nhập, trách nhiệm khi tài khoản bên thứ ba gặp sự cố.
