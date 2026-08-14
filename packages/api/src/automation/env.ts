import 'dotenv/config';

/** Cấu hình automation — không phụ thuộc database, dùng cho script CLI */
export const automationEnv = {
  AUTOMATION_MODE: (process.env.AUTOMATION_MODE ?? 'appium') as 'appium' | 'simulation',
  ADB_PATH: process.env.ADB_PATH ?? 'adb',
  APPIUM_HOST: process.env.APPIUM_HOST ?? '127.0.0.1',
  APPIUM_PORT: parseInt(process.env.APPIUM_PORT ?? '4723', 10),
  ANDROID_DEVICE_SERIAL: process.env.ANDROID_DEVICE_SERIAL ?? '',
  PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS !== 'false',
} as const;
