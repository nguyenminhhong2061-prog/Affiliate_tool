import Redis from 'ioredis';
import { config } from './config';

// Singleton Redis client — export để dùng chung trong toàn app
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableReadyCheck: false,
});

redis.on('error', (err) => {
  console.error('[Redis] Lỗi kết nối:', err.message);
});

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
