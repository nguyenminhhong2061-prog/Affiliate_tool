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

  // SLA — thời gian xử lý trung bình 1 job (giây), đo lường thực tế: 35-45s
  AVG_JOB_SECONDS: parseInt(process.env.AVG_JOB_SECONDS ?? '40', 10),

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
