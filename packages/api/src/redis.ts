import Redis from 'ioredis';
import { config } from './config';

/**
 * Kết nối dùng cho tầng ứng dụng (lưu kết quả job, checkpoint).
 *
 * KHÔNG dùng chung kết nối này cho BullMQ: Queue và Worker cần kết nối riêng
 * (Worker chiếm kết nối ở chế độ blocking). Dùng chung từng khiến job được tạo
 * trong DB nhưng đẩy vào hàng đợi thất bại với "Connection is closed", để lại
 * job kẹt `pending` vĩnh viễn.
 */
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

/** Tạo kết nối Redis mới — mỗi thành phần BullMQ phải có kết nối riêng */
export function createRedisConnection(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

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
