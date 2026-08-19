/**
 * Kiểm tra và chuẩn bị thiết bị Android trước khi chạy job.
 *
 * Mô hình triển khai: một điện thoại thật cắm USB vào server, chạy liên tục.
 * Ở chế độ đó có vài thứ hỏng theo thời gian mà automation không tự biết:
 *   - Máy rớt khỏi ADB (rút cáp, cổng USB chập, adb server chết)
 *   - Màn hình tự khoá → Appium không đọc được UI, mọi bước đều trượt
 *   - App YouTube Studio bị hệ thống kill hoặc bị gỡ
 *   - Máy hết pin / tắt nguồn
 *
 * Chạy kiểm tra trước mỗi job và báo lỗi RÕ RÀNG thay vì để automation
 * thất bại ở một bước ngẫu nhiên giữa chừng.
 *
 * Toàn bộ hàm ở đây BẤT ĐỒNG BỘ — lý do đầy đủ nằm ở đầu `adb.ts`. Tóm tắt: bản
 * cũ dùng execSync và chặn event loop đủ lâu để BullMQ mất lock giữa job.
 */
import { automationEnv } from './env';
import { listConnectedDevices, runAdb, runAdbArgs } from './adb';

const YT_STUDIO_PKG = 'com.google.android.apps.youtube.creator';

export interface DeviceStatus {
  serial: string;
  screenOn: boolean;
  locked: boolean;
  batteryLevel: number;
  studioInstalled: boolean;
}

function adb(serial: string, command: string, timeoutMs = 15000): Promise<string> {
  return runAdb(command, serial, timeoutMs);
}

/** Khởi động lại adb server — cứu được phần lớn trường hợp "máy biến mất" */
export async function restartAdbServer(): Promise<void> {
  // kill-server lỗi cũng không sao, start-server bên dưới mới quan trọng.
  // runAdbArgs không ném lỗi nên không cần try-catch riêng.
  await runAdbArgs(['kill-server'], undefined, 15000);
  await runAdbArgs(['start-server'], undefined, 30000);
}

/**
 * Tìm thiết bị khả dụng. Nếu không thấy, thử khởi động lại adb server một lần
 * rồi tìm lại — xử lý được trường hợp adb server chết mà cáp vẫn cắm.
 */
export async function findDeviceWithRetry(preferred?: string): Promise<string> {
  const wanted = preferred || automationEnv.ANDROID_DEVICE_SERIAL;

  let devices = await listConnectedDevices();
  if (devices.length === 0) {
    console.warn('[DeviceHealth] Không thấy thiết bị — thử khởi động lại adb server...');
    await restartAdbServer();
    devices = await listConnectedDevices();
  }

  if (devices.length === 0) {
    throw new Error(
      'Không có thiết bị Android nào kết nối. Kiểm tra: cáp USB đã cắm chưa, ' +
        'điện thoại còn pin không, "Gỡ lỗi USB" còn bật không.',
    );
  }

  if (wanted) {
    if (!devices.includes(wanted)) {
      throw new Error(
        `Không thấy thiết bị "${wanted}". Thiết bị đang kết nối: ${devices.join(', ')}`,
      );
    }
    return wanted;
  }

  return devices[0];
}

/** Đọc trạng thái hiện tại của thiết bị */
export async function readDeviceStatus(serial: string): Promise<DeviceStatus> {
  const power = await adb(serial, 'shell dumpsys power');
  // Android đổi tên thuộc tính giữa các phiên bản — chấp nhận cả hai dạng
  const screenOn =
    /mWakefulness=Awake/.test(power) || /mScreenOn=true/.test(power) || /Display Power: state=ON/.test(power);

  const locked = /mDreamingLockscreen=true/.test(await adb(serial, 'shell dumpsys window'));

  const batteryRaw = await adb(serial, 'shell dumpsys battery');
  const batteryMatch = batteryRaw.match(/level:\s*(\d+)/);
  const batteryLevel = batteryMatch ? parseInt(batteryMatch[1], 10) : -1;

  const studioInstalled = (await adb(serial, 'shell pm list packages')).includes(YT_STUDIO_PKG);

  return { serial, screenOn, locked, batteryLevel, studioInstalled };
}

/**
 * Chuẩn bị thiết bị: bật màn hình nếu đang tắt, giữ màn hình không tự khoá.
 * Không tự mở khoá bằng mã PIN — thiết bị chạy server nên đặt ở chế độ không khoá.
 */
export async function prepareDevice(serial: string): Promise<void> {
  // Giữ màn hình sáng khi đang cắm sạc/USB — tránh tự khoá giữa chừng job
  try {
    await adb(serial, 'shell svc power stayon usb');
  } catch {
    console.warn('[DeviceHealth] Không đặt được "stay awake" — màn hình có thể tự tắt');
  }

  const status = await readDeviceStatus(serial);
  if (!status.screenOn) {
    console.log('[DeviceHealth] Màn hình đang tắt — bật lên...');
    await adb(serial, 'shell input keyevent KEYCODE_WAKEUP');
  }
}

/**
 * Kiểm tra toàn diện trước khi chạy job. Ném lỗi mô tả rõ nguyên nhân nếu
 * thiết bị không sẵn sàng — để circuit breaker và log biết chính xác vấn đề.
 */
export async function preflightCheck(preferred?: string): Promise<DeviceStatus> {
  const serial = await findDeviceWithRetry(preferred);
  await prepareDevice(serial);

  const status = await readDeviceStatus(serial);

  if (!status.studioInstalled) {
    throw new Error(
      `Thiết bị ${serial} chưa cài YouTube Studio (${YT_STUDIO_PKG}). Cài từ Play Store trước.`,
    );
  }

  if (status.locked) {
    throw new Error(
      `Màn hình thiết bị ${serial} đang khoá. Automation không đọc được giao diện. ` +
        `Hãy tắt khoá màn hình trên thiết bị chạy server (Cài đặt → Bảo mật → Khoá màn hình → Không).`,
    );
  }

  if (status.batteryLevel >= 0 && status.batteryLevel < 15) {
    console.warn(
      `[DeviceHealth] ⚠️ Pin thiết bị còn ${status.batteryLevel}% — kiểm tra cáp sạc`,
    );
  }

  console.log(
    `[DeviceHealth] ✅ ${serial} sẵn sàng (màn hình bật, pin ${status.batteryLevel}%, đã cài YT Studio)`,
  );
  return status;
}
