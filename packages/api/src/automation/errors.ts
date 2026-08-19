/**
 * Phân biệt LỖI ĐẦU VÀO với LỖI HỆ THỐNG.
 *
 * ── Vì sao cần tách ─────────────────────────────────────────────────────────
 * Hai loại lỗi này đòi hỏi ba cách xử lý khác nhau, mà trước đây chúng bị gộp làm
 * một nên cả ba đều sai:
 *
 *   1. THỬ LẠI — lỗi hệ thống (Appium chết, thiết bị rớt, màn hình lạ) thì retry
 *      có ích. Lỗi đầu vào thì retry vô nghĩa: link của người dùng không tự đổi
 *      giữa các lần thử. Người dùng phải chờ 3 × ~40 giây để nhận đúng một thông
 *      báo mà lần đầu đã biết.
 *
 *   2. CẦU CHÌ — cầu chì tồn tại để dừng automation khi nó GÃY (YouTube đổi giao
 *      diện, session hỏng). Đếm cả lỗi đầu vào làm nó ngắt oan: quan sát thật
 *      2026-08-17, một link xấu hỏng 3 lần đã làm job của người kế tiếp bị từ chối
 *      dù link hoàn toàn hợp lệ (nợ kỹ thuật 7.5g).
 *
 *   3. THÔNG BÁO — lỗi hệ thống cần chi tiết kỹ thuật để gỡ rối; lỗi đầu vào cần
 *      một câu người dùng đọc hiểu và biết phải làm gì. Bọc tiền tố
 *      "[Automation Failed]" vào loại thứ hai chỉ làm người dùng hoang mang.
 *
 * ── Nguyên tắc phân loại ────────────────────────────────────────────────────
 * Là lỗi ĐẦU VÀO khi: automation chạy ĐÚNG, giao diện phản hồi ĐÚNG, và kết luận
 * rút ra là về dữ liệu người dùng gửi. Nói cách khác — chạy lại y hệt sẽ cho đúng
 * kết quả đó.
 *
 * Ngược lại, nếu ta không chắc chuyện gì đã xảy ra trên điện thoại thì đó KHÔNG
 * phải lỗi đầu vào, kể cả khi nó trông giống. Khi phân vân, chọn lỗi hệ thống:
 * retry thừa chỉ tốn thời gian, còn bỏ qua một lỗi hệ thống thật thì mất cả cầu
 * chì lẫn cơ hội tự phục hồi.
 */

/** Lỗi thuộc về dữ liệu người dùng gửi — KHÔNG retry, KHÔNG đếm vào cầu chì. */
export class LoiDauVao extends Error {
  /** Cờ nhận diện qua ranh giới module/tiến trình, chắc hơn `instanceof` */
  readonly laLoiDauVao = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'LoiDauVao';
  }
}

/**
 * Nhận diện lỗi đầu vào.
 *
 * Không chỉ dùng `instanceof`: lỗi đi qua nhiều lớp bọc (youtubeAutomation bọc
 * lại, BullMQ tuần tự hoá), nên kiểm cả cờ trên đối tượng.
 */
export function laLoiDauVao(err: unknown): boolean {
  if (err instanceof LoiDauVao) return true;
  return Boolean(err && typeof err === 'object' && 'laLoiDauVao' in err);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tầng phân loại THỨ HAI: lỗi này nói về KÊNH ĐIỀU KHIỂN hay về MÀN HÌNH?
// ─────────────────────────────────────────────────────────────────────────────
//
// Tầng thứ nhất (lỗi đầu vào / lỗi hệ thống) quyết định RETRY, CẦU CHÌ, THÔNG BÁO.
// Tầng này quyết định một việc khác hẳn: có huỷ session Appium dùng chung không.
//
// ── Vì sao "lỗi hệ thống" là tiêu chí SAI cho việc huỷ session ──────────────
// Luật cũ huỷ session cho MỌI lỗi không phải lỗi đầu vào. Nhưng "lỗi hệ thống"
// gộp hai thứ rất khác nhau:
//
//   a) Kênh điều khiển hỏng — session chết, adb rớt, UiAutomator2 sập, máy
//      offline. Session hiện tại vô dụng, phải dựng lại.
//   b) Một bước giao diện không đạt — tap trượt, app render chậm, chờ quá hạn.
//      Session vẫn khoẻ, thiết bị vẫn khoẻ; chỉ là màn hình không như mong đợi.
//
// Loại (b) chiếm phần lớn thực tế. Đo thật lô 5 job ngày 2026-08-19:
//
//     L3: [cho-ket-qua-tim-kiem-tho] Chờ 20s vẫn không thấy kết quả tìm kiếm.
//     L5: [mo-them-san-pham] Không tìm thấy [Thêm].
//
// Cả hai đều là loại (b), và cả hai đều giết session — bắt job kế tiếp trả
// 12,1s (L4) và 11,2s (L6). **23,3 giây lãng phí trong một lô 5 job**, vì một lý
// do không nói gì về sức khoẻ của session.
//
// ── Vì sao giữ session vẫn AN TOÀN với §4.6 ─────────────────────────────────
// Đây là mấu chốt, và nó là lý lẽ mà code đã dùng sẵn cho lỗi đầu vào:
// **trạng thái sạch của APP không đến từ session, nó đến từ `force-stop`.**
// `init()` luôn force-stop ở đầu mỗi job, trừ khi đọc được cây a11y và XÁC MINH
// DƯƠNG TÍNH là đang ở màn Mua sắm sạch. Nên giữ lại kênh điều khiển không hề
// làm mất đảm bảo "bắt đầu từ trạng thái biết chắc".
//
// Chốt sống/chết vẫn còn nguyên: `init()` gọi `getWindowSize()` trước khi tái
// dùng, session chết thì bị phát hiện và dựng lại ngay tại đó.
//
// ── Van an toàn ─────────────────────────────────────────────────────────────
// Từ lần thử THỨ HAI trở đi thì huỷ session bất kể lỗi gì. Lần đầu ta đã đặt
// cược "session vẫn tốt"; nếu chạy lại vẫn hỏng thì tiền đề đó đáng nghi, và
// 11 giây là cái giá rẻ để loại trừ một biến. Van này chặn đúng kịch bản xấu
// nhất: một session hỏng âm thầm nhưng vẫn trả lời `getWindowSize()`.

/**
 * Dấu hiệu cho biết KÊNH ĐIỀU KHIỂN hỏng, không phải màn hình sai.
 *
 * Cố ý dùng danh sách ĐÓNG thay vì bắt rộng: bắt sót một lỗi hạ tầng chỉ khiến
 * lần thử sau tốn thêm chút thời gian rồi van an toàn dọn nốt, còn bắt nhầm một
 * lỗi giao diện thì quay lại đúng chỗ lãng phí 11 giây mà mục này sinh ra để bỏ.
 */
const DAU_HIEU_HONG_KENH = [
  // — Session Appium không còn tồn tại —
  'invalid session id',
  'nosuchdriver',
  'a session is either terminated or not started',
  'session not created',
  'terminated or not started',

  // — Không nối được tới Appium server —
  'econnrefused',
  'econnreset',
  'etimedout',
  'epipe',
  'socket hang up',
  'could not proxy command to the remote server',

  // — UiAutomator2 trên máy sập —
  'instrumentation process is not running',
  'uiautomator2 server',
  'cannot be proxied to uiautomator2 server',

  // — Thiết bị rớt / adb hỏng —
  'device offline',
  'device unauthorized',
  'device not found',
  'no devices/emulators found',
  'adb.exe: device',
  'error: device',
  'daemon not running',
];

/** Lỗi này nói rằng session/thiết bị hỏng (chứ không phải màn hình sai)? */
export function laLoiHongKenhDieuKhien(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const name = (err instanceof Error ? err.name : '').toLowerCase();
  if (name === 'nosuchdriver' || name === 'invalidsessioniderror') return true;
  return DAU_HIEU_HONG_KENH.some((d) => msg.includes(d));
}

/**
 * Có nên huỷ session Appium dùng chung sau lỗi này không, và vì sao.
 *
 * Trả về cả lý do để log giải thích được quyết định — khi một job sau đó chậm
 * bất thường vì phải dựng session, dòng log này là thứ cho biết tại sao.
 *
 * @param lanThu số thứ tự lần thử của BullMQ (1 = lần đầu). 0/undefined = không rõ.
 */
export function coNenHuySession(
  err: unknown,
  lanThu = 0,
): { huy: boolean; lyDo: string } {
  if (laLoiDauVao(err)) {
    return { huy: false, lyDo: 'lỗi do link người dùng — thiết bị vẫn khoẻ' };
  }
  if (laLoiHongKenhDieuKhien(err)) {
    return { huy: true, lyDo: 'session/thiết bị hỏng — phải dựng lại' };
  }
  if (lanThu >= 2) {
    return {
      huy: true,
      lyDo: `hỏng lại ở lần thử ${lanThu} — loại trừ khả năng session âm thầm lỗi`,
    };
  }
  return {
    huy: false,
    lyDo: 'lỗi ở một bước giao diện — session vẫn khoẻ, force-stop đủ để bắt đầu sạch',
  };
}
