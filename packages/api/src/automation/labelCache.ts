/**
 * Ghi nhớ toạ độ của các nhãn phải tìm bằng OCR.
 *
 * ── Vấn đề ──────────────────────────────────────────────────────────────────
 * App YouTube Studio vẽ chữ bằng canvas nên nhiều nhãn ("Tìm sản phẩm",
 * "Người bán", "Shopee"...) không có trong accessibility tree. Mỗi lần cần tìm
 * một nhãn như vậy, `Screen.find()` phải chụp màn hình (604ms) rồi chạy OCR
 * (1959ms) — 2,6 giây cho một thao tác mà kết quả luôn giống hệt nhau, vì thiết
 * bị cố định, độ phân giải cố định, bố cục app cố định.
 *
 * ── Cách làm ────────────────────────────────────────────────────────────────
 * Học một lần bằng OCR, lưu lại toạ độ, những lần sau tap thẳng vào đó.
 *
 * ── Vì sao không phá vỡ các lớp bảo vệ đã có ────────────────────────────────
 * Đây là chỗ dễ sai nhất, nên nói rõ: cache CHỈ thay thế bước ĐỊNH VỊ, tuyệt
 * đối không thay thế bước XÁC MINH. Toạ độ nhớ sẵn chỉ được dùng bên trong
 * `tapUntilVisible` và `typeIntoLabeledInput` — hai chỗ đã có sẵn cơ chế kiểm
 * tra thao tác có hiệu lực hay không (CLAUDE.md §4.5, §4.6). Tap trượt thì dấu
 * hiệu xác minh không xuất hiện, mục cache bị xoá, và lần thử lại quay về OCR
 * đầy đủ. Nói cách khác cache sai sẽ tự chữa trong đúng một lần thử, chứ không
 * tạo ra "thành công giả" — thứ mà §4.5 đã trả giá để học.
 *
 * Riêng menu ngữ cảnh của bộ sưu tập (Chỉnh sửa / Chia sẻ / **Xoá**) KHÔNG được
 * dùng cache dù có tiết kiệm được: ở đó một cú tap lệch là xoá bộ sưu tập thật
 * của người dùng, mà xác minh sau khi tap không hoàn tác được việc đã xoá. Các
 * mục menu này vốn có nhãn trong accessibility tree nên cũng không tốn OCR —
 * không mất gì khi loại trừ.
 *
 * ── Vì sao lưu ra đĩa ────────────────────────────────────────────────────────
 * Tiến trình API khởi động lại thường xuyên (ts-node-dev --respawn). Giữ trong
 * RAM thì mỗi lần restart lại phải học lại từ đầu, tức là job đầu tiên sau mỗi
 * lần sửa code luôn chậm.
 */
import * as fs from 'fs';
import * as path from 'path';

const CACHE_DIR = path.join(__dirname, '../../.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'label-coords.json');

export interface CachedPoint {
  x: number;
  y: number;
  /** Nhãn thực tế đã khớp lúc học — để đọc log và gỡ rối */
  matched: string;
  /** ISO time lúc học được */
  learnedAt: string;
}

type CacheShape = Record<string, CachedPoint>;

let cache: CacheShape | null = null;

function load(): CacheShape {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    cache = JSON.parse(raw) as CacheShape;
  } catch {
    // Chưa có file, file hỏng, hoặc không đọc được — bắt đầu lại từ rỗng.
    // Không có gì để cứu ở đây: mất cache chỉ tốn thêm vài giây học lại.
    cache = {};
  }
  return cache;
}

function persist(): void {
  if (!cache) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.warn('[LabelCache] Không ghi được cache ra đĩa:', (err as Error).message);
  }
}

/**
 * Khoá gồm cả thiết bị và kích thước màn hình: toạ độ tuyệt đối chỉ đúng với
 * đúng một độ phân giải. Đổi máy hoặc đổi độ phân giải là sinh khoá khác, cache
 * cũ tự trở thành vô hại thay vì trở thành nguy hiểm.
 */
export function buildDeviceKey(serial: string, width: number, height: number): string {
  // Không có serial thì KHÔNG sinh khoá. Các script chẩn đoán dựng Screen mà
  // không truyền serial; nếu vẫn sinh khoá thì mọi thiết bị cùng độ phân giải sẽ
  // dùng chung một mục cache — toạ độ học từ máy này đem tap lên máy khác.
  if (!serial) return '';
  return `${serial}@${width}x${height}`;
}

export function getCachedPoint(deviceKey: string, stepName: string): CachedPoint | null {
  return load()[`${deviceKey}|${stepName}`] ?? null;
}

export function rememberPoint(
  deviceKey: string,
  stepName: string,
  point: { x: number; y: number; matched: string },
): void {
  const store = load();
  const key = `${deviceKey}|${stepName}`;
  const existing = store[key];

  // Không ghi lại nếu toạ độ không đổi — tránh ghi đĩa ở mọi job
  if (existing && existing.x === point.x && existing.y === point.y) return;

  store[key] = { ...point, learnedAt: new Date().toISOString() };
  persist();
}

export function forgetPoint(deviceKey: string, stepName: string): void {
  const store = load();
  const key = `${deviceKey}|${stepName}`;
  if (!(key in store)) return;
  delete store[key];
  persist();
}

/** Xoá toàn bộ — dùng khi YouTube đổi giao diện và mọi toạ độ đều sai */
export function clearLabelCache(): void {
  cache = {};
  persist();
}
