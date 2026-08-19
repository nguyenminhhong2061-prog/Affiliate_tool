/**
 * Lớp gọi adb.
 *
 * ── Vì sao BẤT ĐỒNG BỘ, và vì sao đừng đổi ngược lại ─────────────────────────
 * Bản đầu dùng `execSync`. Nó chặn cứng event loop của Node suốt thời gian adb
 * chạy — và trong lúc tạo session Appium, quãng đó dài 13-42 giây. Mọi thứ khác
 * trong tiến trình đứng hình: timer không nổ, promise không tiếp tục, request HTTP
 * không nhích.
 *
 * Đã gây hai lỗi thật, cái sau nghiêm trọng hơn nhiều:
 *
 *   1. `resolveProductRef()` chạy song song bị huỷ, vì AbortController đếm theo
 *      đồng hồ treo tường: loop vừa được giải phóng là timer quá hạn nổ ngay.
 *
 *   2. (2026-08-17) BullMQ MẤT LOCK giữa job. Lock mặc định 30 giây, gia hạn
 *      bằng timer ở mốc 15 giây — mà timer không chạy được khi loop bị chặn 41,9
 *      giây. Hậu quả: một job ĐÃ THÀNH CÔNG (gắn sản phẩm, trích được link) không
 *      ghi nhận được kết quả (`Missing lock ... moveToFinished`), bị BullMQ coi là
 *      stalled và chạy lại 2 lần nữa trên điện thoại thật, rồi báo `failed` cho
 *      người dùng trong khi link vẫn nằm trong Redis.
 *
 * `execFile` không đi qua shell nên tham số truyền dạng MẢNG, không phải chuỗi đã
 * tự chèn dấu nháy. Đó cũng là lý do bản này an toàn hơn với đường dẫn có khoảng
 * trắng và với URL có ký tự đặc biệt.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { automationEnv } from './env';

const execFileAsync = promisify(execFile);

/** `dumpsys window` có thể trả vài trăm KB — đừng để tràn buffer thành lỗi khó hiểu */
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

/**
 * Gọi adb với tham số đã tách sẵn thành mảng — dạng dùng chính.
 *
 * Không ném lỗi: adb hay ghi thông tin hữu ích ra stderr kèm mã thoát khác 0
 * (ví dụ `device offline`), và các hàm gọi phía trên muốn tự đọc chuỗi đó để
 * quyết định. Giữ nguyên hành vi "trả chuỗi" của bản execSync cũ.
 */
async function runAdbArgs(args: string[], serial?: string, timeoutMs = 15000): Promise<string> {
  const full = serial ? ['-s', serial, ...args] : args;
  try {
    const { stdout } = await execFileAsync(automationEnv.ADB_PATH, full, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return stdout.trim();
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return (e.stdout || e.stderr || e.message || '').trim();
  }
}

/**
 * Dạng tiện lợi nhận chuỗi, tách theo khoảng trắng.
 *
 * CHỈ dùng cho lệnh không có tham số chứa khoảng trắng hoặc dấu nháy có nghĩa.
 * Lệnh phức tạp (deep link `am start -d '<url>'`) phải gọi `runAdbArgs` và tự gom
 * phần cần giữ nguyên vào MỘT phần tử mảng.
 */
async function runAdb(args: string, serial?: string, timeoutMs = 15000): Promise<string> {
  return runAdbArgs(args.split(/\s+/).filter(Boolean), serial, timeoutMs);
}

/** Liệt kê serial các thiết bị Android đang kết nối (status = device) */
export async function listConnectedDevices(): Promise<string[]> {
  const output = await runAdbArgs(['devices']);
  return output
    .split('\n')
    .filter((line) => line.includes('\tdevice'))
    .map((line) => line.split('\t')[0].trim())
    .filter(Boolean);
}

/** Lấy serial thiết bị đầu tiên, hoặc serial được cấu hình sẵn */
export async function resolveDeviceSerial(preferred?: string): Promise<string> {
  if (preferred) return preferred;
  if (automationEnv.ANDROID_DEVICE_SERIAL) return automationEnv.ANDROID_DEVICE_SERIAL;

  const devices = await listConnectedDevices();
  if (devices.length === 0) {
    throw new Error(
      'Không tìm thấy thiết bị Android. Hãy kết nối USB/WiFi và chạy: npm run check-adb',
    );
  }
  return devices[0];
}

/** Đọc nội dung clipboard từ thiết bị qua ADB (Android 10+) */
export async function getDeviceClipboard(serial: string): Promise<string> {
  const output = await runAdbArgs(['shell', 'cmd', 'clipboard', 'get'], serial);
  return output.replace(/^clip:\s*/i, '').trim();
}

/** Kiểm tra YouTube Studio đã cài trên thiết bị */
export async function isYoutubeStudioInstalled(serial: string): Promise<boolean> {
  const packages = await runAdbArgs(['shell', 'pm', 'list', 'packages'], serial);
  return packages.includes('com.google.android.apps.youtube.creator');
}

export { runAdb, runAdbArgs };
