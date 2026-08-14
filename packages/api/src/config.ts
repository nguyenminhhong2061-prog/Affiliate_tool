import 'dotenv/config';

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

  get isDev() {
    return this.NODE_ENV === 'development';
  },
} as const;
