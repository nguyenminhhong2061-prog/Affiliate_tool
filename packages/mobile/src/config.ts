// ─── Cấu hình app ─────────────────────────────────────────────────────────────

/**
 * URL của API. Đọc từ file .env ở thư mục gốc của package này.
 *
 * Lưu ý bắt buộc (tài liệu Expo SDK 57): chỉ biến có tiền tố `EXPO_PUBLIC_` mới
 * được Expo CLI nhúng vào bundle, và **phải** truy cập bằng dot notation tĩnh
 * (`process.env.EXPO_PUBLIC_API_URL`). Viết kiểu `process.env['...']` hoặc
 * destructure sẽ không được thay thế lúc build → giá trị là undefined.
 *
 * Đổi giá trị trong .env rồi **reload hẳn app** (không chỉ restart Metro) mới ăn.
 */
const fromEnv = process.env.EXPO_PUBLIC_API_URL;

/** Bỏ dấu `/` thừa ở cuối để nối đường dẫn không bị `//` */
export const API_BASE_URL = (fromEnv ?? 'http://192.168.1.14:3000').replace(/\/+$/, '');

export const API_PREFIX = '/api/v1';

/**
 * Chu kỳ hỏi lại trạng thái job (ms).
 *
 * ── Vì sao KHÔNG còn là 5000 ────────────────────────────────────────────────
 * App chỉ BIẾT job xong tại các mốc hỏi. Job kết thúc ở thời điểm liên tục bất
 * kỳ, nên thời gian người dùng nhìn thấy bị làm tròn LÊN mốc kế tiếp:
 *
 *     job xong 30,2s  →  hỏi lúc 35s  →  thấy link lúc 35s
 *     job xong 34,0s  →  hỏi lúc 35s  →  thấy link lúc 35s
 *     job hỏng 31,0s  →  hỏi lúc 35s  →  thấy lỗi  lúc 35s
 *
 * Tức là **thêm trung bình 2,5 giây, tối đa 5 giây** vào mọi job — thuần tuý do
 * giao diện, không phải do hệ thống chậm. Với job ~30 giây thì đó là ~8% thời
 * gian chờ, và nó cũng làm mọi phép đo qua giao diện dài hơn thực tế.
 *
 * Ở 1000ms, độ trễ đo thật qua Playwright còn **0,64 / 1,03 / 1,24 giây** (3 lượt).
 *
 * ── Cái giá ─────────────────────────────────────────────────────────────────
 * ~27-34 lượt gọi API mỗi job thay vì ~7. API trả lời trong 5-50ms nên không
 * đáng kể ở quy mô hiện tại.
 */
export const POLL_INTERVAL_MS = 1000;

/**
 * Nhịp hỏi khi CÒN NGƯỜI PHÍA TRƯỚC trong hàng đợi (ms).
 *
 * Hàng đợi chạy tuần tự một job một lúc, mỗi job ~35 giây. Nên khi `queue_position`
 * lớn hơn 1, chắc chắn còn ít nhất một job nữa mới tới lượt mình — hỏi mỗi giây
 * ở đó là hỏi lại cùng một câu trả lời 35 lần liên tiếp.
 *
 * ⚠️ CHỈ áp dụng khi `queue_position > 1`, tuyệt đối KHÔNG áp cho mọi trạng thái
 * `pending`. Đo thật 2026-08-19: khi hàng đợi trống, job chuyển sang `processing`
 * sau **249 ms**. Lượt hỏi đầu tiên (t ≈ 70ms) vẫn thấy `pending`, nên nếu lúc đó
 * hẹn lượt kế ở 35 giây thì:
 *
 *     job xong 27,4s  →  hỏi lúc 35s  →  người dùng chờ thêm 7,6 giây
 *
 * tức là dựng lại đúng lỗi làm tròn mà `POLL_INTERVAL_MS` sinh ra để xoá, và còn
 * tệ hơn mức 5 giây ban đầu. `queue_position` mới là dấu hiệu đúng: nó nói "còn
 * bao nhiêu người trước mình", chứ `pending` chỉ nói "worker chưa nhận job".
 */
export const POLL_INTERVAL_QUEUED_MS = 35000;

/**
 * Chờ tối đa trước khi bỏ cuộc (ms).
 *
 * Một job đo thật ~40 giây ở trạng thái ổn định (2026-08-17, sau các đợt tối ưu;
 * trước đó là 123 giây). Nhưng còn phải cộng thời gian xếp hàng — hàng đợi xử lý
 * tuần tự 1 job một lúc — và tối đa 3 lần retry của BullMQ, nên vẫn để rộng tay.
 */
export const POLL_TIMEOUT_MS = 15 * 60 * 1000;

/** Timeout cho một lời gọi HTTP đơn lẻ (ms) */
export const REQUEST_TIMEOUT_MS = 15000;
