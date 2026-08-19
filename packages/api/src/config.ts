import 'dotenv/config';
import { automationEnv } from './automation/env';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`[Config] Biến môi trường bắt buộc "${key}" chưa được set.`);
  }
  return value;
}

export const config = {
  // Server
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',

  // Database
  DATABASE_URL: requireEnv('DATABASE_URL'),

  // Redis
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // SLA — thời gian xử lý trung bình 1 job (giây).
  //
  // Đo thật sau đợt tối ưu 2026-08-16: 68,7s khi cache trúng, 101s cho job đầu
  // sau khi khởi động lại tiến trình (chưa có session Appium, chưa có link chia
  // sẻ trong cache). Để 75 — nhỉnh hơn trường hợp thường gặp, vì hứa non tệ hơn
  // hứa thừa (CLAUDE.md §10.6).
  //
  // Giá trị mặc định này từng là 40 và bị bỏ quên suốt nhiều tuần vì .env luôn
  // ghi đè — nhớ sửa cả hai chỗ khi thời gian thật thay đổi.
  AVG_JOB_SECONDS: parseInt(process.env.AVG_JOB_SECONDS ?? '45', 10),

  // Automation — re-export từ automation/env (xem automation.md)
  AUTOMATION_MODE: automationEnv.AUTOMATION_MODE,
  ADB_PATH: automationEnv.ADB_PATH,
  APPIUM_HOST: automationEnv.APPIUM_HOST,
  APPIUM_PORT: automationEnv.APPIUM_PORT,
  ANDROID_DEVICE_SERIAL: automationEnv.ANDROID_DEVICE_SERIAL,
  PLAYWRIGHT_HEADLESS: automationEnv.PLAYWRIGHT_HEADLESS,

  get isDev() {
    return this.NODE_ENV === 'development';
  },
} as const;
