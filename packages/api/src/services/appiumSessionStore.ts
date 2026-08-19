/**
 * Ghi nhớ session Appium qua các lần KHỞI ĐỘNG LẠI TIẾN TRÌNH.
 *
 * ── Vấn đề ──────────────────────────────────────────────────────────────────
 * `sharedDriver` nằm trong RAM của tiến trình API. Tiến trình chết là mất — dù
 * session vẫn còn sống nguyên trên Appium server và điện thoại vẫn đang ở trạng
 * thái sẵn sàng. Job đầu tiên sau đó trả **11-14 giây** dựng lại một thứ đang
 * tồn tại, còn session cũ nằm mồ côi tới khi hết `newCommandTimeout` (1 giờ).
 *
 * Đây là nguyên nhân dựng lại session còn sót lại lớn nhất sau khi §4.14 xử lý
 * xong nhóm "huỷ oan vì lỗi giao diện". Nó xảy ra ở mọi lần: `ts-node-dev` nạp
 * lại khi sửa file, tiến trình crash, hoặc triển khai bản mới.
 *
 * ── Cách làm ────────────────────────────────────────────────────────────────
 * Lưu `sessionId` + `capabilities` vào Redis. Lần khởi động sau, `init()` gọi
 * `attach()` của webdriverio để nối lại đúng session đó thay vì tạo mới.
 *
 * ── Vì sao an toàn ──────────────────────────────────────────────────────────
 * Bản ghi này chỉ là một GỢI Ý, không phải nguồn sự thật. Mọi đường dùng nó đều
 * đi qua đúng chốt sống/chết đã có: `getWindowSize()` phải trả lời được thì mới
 * dùng, không thì xoá bản ghi và dựng session mới như cũ. Nên trường hợp xấu
 * nhất của một bản ghi cũ/sai là mất thêm một vòng gọi mạng (~1,5 giây, đo thật
 * từ log wdio: nó thử lại 3 lần trước khi bỏ cuộc).
 *
 * Trạng thái APP vẫn được đảm bảo bởi `force-stop` trong `init()` như mọi khi —
 * nối lại session không đụng tới đảm bảo đó (§4.6).
 *
 * ── TTL ─────────────────────────────────────────────────────────────────────
 * Đặt ngắn hơn `newCommandTimeout` (3600s) một khoảng an toàn. Bản ghi sống lâu
 * hơn session thật chỉ tạo ra những lần nối lại chắc chắn trượt.
 */
import { redis } from '../redis';

const KEY = 'appium:shared-session';

/** 3000s = 50 phút, dưới newCommandTimeout 3600s một biên 10 phút */
const TTL_SECONDS = 3000;

export interface StoredAppiumSession {
  sessionId: string;
  /** Serial thiết bị lúc tạo — nối lại nhầm máy còn tệ hơn dựng mới */
  serial: string;
  /** `attach()` cần capabilities để dựng lại đúng bộ lệnh cho driver */
  capabilities: Record<string, unknown>;
  savedAt: string;
}

export async function luuSession(s: Omit<StoredAppiumSession, 'savedAt'>): Promise<void> {
  const payload: StoredAppiumSession = { ...s, savedAt: new Date().toISOString() };
  try {
    await redis.set(KEY, JSON.stringify(payload), 'EX', TTL_SECONDS);
  } catch (e) {
    // Không để việc ghi nhớ làm hỏng job: mất bản ghi chỉ tốn 11 giây lần sau.
    console.warn(`[AppiumSession] Không lưu được session vào Redis: ${(e as Error).message}`);
  }
}

export async function docSession(): Promise<StoredAppiumSession | null> {
  try {
    const raw = await redis.get(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAppiumSession;
    if (!parsed?.sessionId || !parsed?.serial) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function xoaSession(): Promise<void> {
  try {
    await redis.del(KEY);
  } catch {
    // im lặng: bản ghi thừa tự hết hạn theo TTL
  }
}
