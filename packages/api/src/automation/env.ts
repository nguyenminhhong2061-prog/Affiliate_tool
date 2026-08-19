import * as path from 'path';
import * as dotenv from 'dotenv';

// Nạp .env của package trước (nếu có), rồi tới .env ở gốc monorepo.
// dotenv không ghi đè biến đã tồn tại, nên thứ tự này cho phép package tự ghi đè
// cấu hình chung khi cần, và biến môi trường thật của shell luôn thắng.
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

/** Cấu hình automation — không phụ thuộc database, dùng cho script CLI */
export const automationEnv = {
  AUTOMATION_MODE: (process.env.AUTOMATION_MODE ?? 'appium') as 'appium' | 'simulation',
  ADB_PATH: process.env.ADB_PATH ?? 'adb',
  APPIUM_HOST: process.env.APPIUM_HOST ?? '127.0.0.1',
  APPIUM_PORT: parseInt(process.env.APPIUM_PORT ?? '4723', 10),
  ANDROID_DEVICE_SERIAL: process.env.ANDROID_DEVICE_SERIAL ?? '',
  PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS !== 'false',

  /** ID kênh YouTube — dùng cho deep link mở thẳng màn Mua sắm */
  YT_CHANNEL_ID: process.env.YT_CHANNEL_ID ?? '',
  /** Tên bộ sưu tập cần gắn sản phẩm vào (bỏ trống = bộ sưu tập đầu tiên) */
  YT_COLLECTION_NAME: process.env.YT_COLLECTION_NAME ?? '',

  /**
   * Giữ session Appium sống giữa các job (tiết kiệm ~10,5 giây tạo session).
   *
   * App vẫn được `force-stop` ở đầu MỖI job, nên đảm bảo "bắt đầu từ trạng thái
   * sạch" của CLAUDE.md §4.6 không mất đi — 10,5 giây kia là chi phí bắt tay với
   * UiAutomator2, không phải chi phí khởi động app. Session cũng bị huỷ bỏ sau
   * mỗi job THẤT BẠI, để lần retry bắt đầu hoàn toàn mới.
   *
   * Đặt 0 để tắt khi cần loại trừ nguyên nhân lúc gỡ rối.
   */
  APPIUM_REUSE_SESSION: process.env.APPIUM_REUSE_SESSION !== '0',

  /**
   * Bỏ hẳn bước OCR đọc tên sản phẩm (~2,6 giây/job).
   *
   * Sau khi sửa lỗi trả sai sản phẩm (2026-08-16), tên sản phẩm chỉ còn được
   * dùng khi KHÔNG giải được ID từ link đầu vào — vì khi đã biết ID thì bước
   * trích link so theo ID và không có đường lui nào theo tên nữa. Đã kiểm chứng
   * thật: job chạy đúng với PRODUCT_NAME rỗng.
   *
   * Nghĩa là bật cờ này an toàn CHỪNG NÀO link đầu vào luôn giải ra ID. Link
   * rút gọn cần một lần gọi mạng để giải, và lần đó có thể hỏng (đã gặp: adb
   * execSync chặn event loop làm huỷ request). Khi đó tên sản phẩm là thứ duy
   * nhất còn lại — bật cờ này sẽ làm job mất nốt đường cuối và hỏng.
   *
   * Vì vậy vẫn mặc định TẮT: nó chỉ đổi 2,6 giây lấy việc bỏ đi lưới an toàn
   * cho một nhánh hiếm nhưng có thật.
   */
  AUTOMATION_SKIP_PRODUCT_OCR: process.env.AUTOMATION_SKIP_PRODUCT_OCR === '1',

  /**
   * Độ trễ ngẫu nhiên giữa các thao tác. MẶC ĐỊNH TẮT từ 2026-08-17.
   *
   * ── Đây là một quyết định đánh đổi rủi ro, không phải một tối ưu kỹ thuật ──
   *
   * `humanDelay` tồn tại để nhịp thao tác không đều như máy (CLAUDE.md §10.5).
   * Đo thật: 8 lần/job, 9,5 giây — khoản lớn thứ tư của một job 73,6 giây, và là
   * nguồn duy nhất còn đủ lớn sau khi đã vắt hết các khoản khác.
   *
   * Chủ dự án đã chọn tắt (2026-08-17) để hạ thời gian job. Cần hiểu rõ cái giá:
   * hệ thống chỉ có MỘT tài khoản YouTube đủ điều kiện, mất tài khoản là dừng
   * toàn bộ, và automation trên giao diện bên thứ ba vốn đã nằm trong vùng vi
   * phạm điều khoản dịch vụ (§10.1).
   *
   * Để dưới dạng CỜ chứ không xoá code, vì đây là thứ có thể cần bật lại gấp:
   * thấy captcha, thấy yêu cầu xác minh thiết bị, thấy thao tác bị chặn bất
   * thường → đặt AUTOMATION_HUMAN_DELAY=1 là quay lại nhịp cũ ngay, không phải
   * sửa lại luồng dưới áp lực.
   */
  AUTOMATION_HUMAN_DELAY: process.env.AUTOMATION_HUMAN_DELAY === '1',
} as const;
