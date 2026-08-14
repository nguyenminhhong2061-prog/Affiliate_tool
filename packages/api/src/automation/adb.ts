import { execSync } from 'child_process';
import { automationEnv } from './env';

function runAdb(args: string, serial?: string): string {
  const adb = automationEnv.ADB_PATH;
  const prefix = serial ? `"${adb}" -s ${serial}` : `"${adb}"`;
  try {
    return execSync(`${prefix} ${args}`, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return (e.stdout || e.stderr || e.message || '').trim();
  }
}

/** Liệt kê serial các thiết bị Android đang kết nối (status = device) */
export function listConnectedDevices(): string[] {
  const output = runAdb('devices');
  return output
    .split('\n')
    .filter((line) => line.includes('\tdevice'))
    .map((line) => line.split('\t')[0].trim())
    .filter(Boolean);
}

/** Lấy serial thiết bị đầu tiên, hoặc serial được cấu hình sẵn */
export function resolveDeviceSerial(preferred?: string): string {
  if (preferred) return preferred;
  if (automationEnv.ANDROID_DEVICE_SERIAL) return automationEnv.ANDROID_DEVICE_SERIAL;

  const devices = listConnectedDevices();
  if (devices.length === 0) {
    throw new Error(
      'Không tìm thấy thiết bị Android. Hãy kết nối USB/WiFi và chạy: npm run check-adb',
    );
  }
  return devices[0];
}

/** Đọc nội dung clipboard từ thiết bị qua ADB (Android 10+) */
export function getDeviceClipboard(serial: string): string {
  const output = runAdb('shell cmd clipboard get', serial);
  return output.replace(/^clip:\s*/i, '').trim();
}

/** Kiểm tra YouTube Studio đã cài trên thiết bị */
export function isYoutubeStudioInstalled(serial: string): boolean {
  const packages = runAdb('shell pm list packages', serial);
  return packages.includes('com.google.android.apps.youtube.creator');
}

export { runAdb };
