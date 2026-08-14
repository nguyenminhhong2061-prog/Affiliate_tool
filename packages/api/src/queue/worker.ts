import { Worker, Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { jobs } from '../db/schema';
import { redis } from '../redis';
import { YOUTUBE_TAGGING_QUEUE_NAME, type YoutubeTaggingJobData } from './queue';
import { tagShopeeProductOnYoutube } from '../automation/youtubeAutomation';
import { youtubeCircuitBreaker } from '../automation/circuitBreaker';

/**
 * Hàm xử lý chính cho từng job trong hàng đợi
 */
async function processYoutubeTaggingJob(job: Job<YoutubeTaggingJobData>) {
  const { jobId, shopeeUrl, shopeeProductId } = job.data;
  console.log(`[Worker] Bắt đầu xử lý Job ID: ${jobId} (Link: ${shopeeUrl})`);

  // 1. Kiểm tra Circuit Breaker (Cầu chì an toàn)
  if (!youtubeCircuitBreaker.canExecute()) {
    const errorMsg = '[CircuitBreaker] Cầu chì đang ở trạng thái OPEN. Tạm ngắt worker để bảo vệ tài khoản.';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // 2. Cập nhật trạng thái DB -> 'processing'
  await db
    .update(jobs)
    .set({ status: 'processing' })
    .where(eq(jobs.id, jobId));

  await job.updateProgress(20);

  // 3. Thực thi Appium + Playwright Automation Pipeline
  try {
    const result = await tagShopeeProductOnYoutube({
      jobId,
      shopeeUrl,
      shopeeProductId,
    });

    await job.updateProgress(90);

    // Ghi nhận thành công cho Circuit Breaker
    youtubeCircuitBreaker.recordSuccess();

    // 4. Cập nhật kết quả vào DB -> status = 'done'
    await db
      .update(jobs)
      .set({
        status: 'done',
        resultUrl: result.affiliateUrl,
        resultVoucher: result.voucher,
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    await job.updateProgress(100);
    console.log(`[Worker] ✅ Hoàn thành Job ID: ${jobId} -> Result: ${result.affiliateUrl}`);

    return {
      jobId,
      resultUrl: result.affiliateUrl,
      voucher: result.voucher,
    };
  } catch (err: any) {
    // Ghi nhận thất bại cho Circuit Breaker
    youtubeCircuitBreaker.recordFailure(err.message);
    throw err;
  }
}

// Khởi tạo BullMQ Worker với CONCURRENCY = 1 (Ràng buộc cứng xử lý tuần tự)
export function initWorker() {
  const worker = new Worker<YoutubeTaggingJobData>(
    YOUTUBE_TAGGING_QUEUE_NAME,
    processYoutubeTaggingJob,
    {
      connection: redis,
      concurrency: 1, // CHỈ XỬ LÝ TUẦN TỰ 1 JOB TẠI 1 THỜI ĐIỂM
      limiter: {
        max: 1,
        duration: 3000, // Khoảng cách tối thiểu 3 giây giữa các job
      },
    },
  );

  worker.on('completed', (job) => {
    console.log(`[Worker Event] Job ${job.id} đã hoàn thành trong hàng đợi.`);
  });

  worker.on('failed', async (job, err) => {
    console.error(`[Worker Event] Job ${job?.id} thất bại:`, err.message);
    if (job?.data?.jobId) {
      // Cập nhật DB -> status = 'failed'
      await db
        .update(jobs)
        .set({
          status: 'failed',
          errorMessage: err.message,
        })
        .where(eq(jobs.id, job.data.jobId));
    }
  });

  worker.on('error', (err) => {
    console.error('[Worker System Error]:', err.message);
  });

  console.log('⚡ [Worker] Appium + Playwright Worker đã sẵn sàng (Concurrency: 1)');
  return worker;
}
