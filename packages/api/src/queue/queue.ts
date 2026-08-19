import { Queue } from 'bullmq';
import { createRedisConnection } from '../redis';

// Tên hàng đợi chính của hệ thống
export const YOUTUBE_TAGGING_QUEUE_NAME = 'youtube-tagging';

export interface YoutubeTaggingJobData {
  jobId: string;
  shopeeUrl: string;
  shopeeProductId?: string | null;
  userId: string;
}

// Khởi tạo BullMQ Queue Producer
export const youtubeQueue = new Queue<YoutubeTaggingJobData>(YOUTUBE_TAGGING_QUEUE_NAME, {
  // Kết nối riêng — xem ghi chú trong redis.ts
  connection: createRedisConnection(),
  defaultJobOptions: {
    // Tự động xoá job đã hoàn thành sau 24h hoặc tối đa 1000 jobs
    removeOnComplete: { age: 86400, count: 1000 },
    // Tự động xoá job thất bại sau 7 ngày hoặc tối đa 5000 jobs
    removeOnFail: { age: 604800, count: 5000 },
    // Cấu hình retry tự động 3 lần với exponential backoff
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // Thử lại sau 5s, 10s, 20s
    },
  },
});

/**
 * Đẩy một job mới vào hàng đợi BullMQ
 */
export async function addJobToQueue(data: YoutubeTaggingJobData) {
  const job = await youtubeQueue.add('tag-product', data, {
    jobId: data.jobId, // Dùng UUID job_id làm BullMQ job ID để dễ tra cứu
  });
  console.log(`[Queue] Đã đẩy Job ${data.jobId} vào hàng đợi (BullMQ Job ID: ${job.id})`);
  return job;
}
