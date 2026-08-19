import { eq, and, inArray, lt, count } from 'drizzle-orm';
import { db } from '../db/client';
import { jobs } from '../db/schema';
import { parseShopeeUrl } from './shopee';
import { addJobToQueue } from '../queue/queue';
import { config } from '../config';
import { getJobResult, type JobResult } from './jobResult';
import type { JobDetailResponse } from '../types';

// ─── Tính toán hàng đợi ───────────────────────────────────────────────────────

/**
 * Đếm số job đang pending/processing trong hàng đợi
 * → Dùng để tính vị trí hàng đợi và thời gian chờ ước tính
 */
async function countActiveJobs(): Promise<number> {
  const result = await db
    .select({ value: count() })
    .from(jobs)
    .where(inArray(jobs.status, ['pending', 'processing']));
  return result[0]?.value ?? 0;
}

/**
 * Tính vị trí trong hàng đợi của một job cụ thể
 * (số job pending/processing được tạo TRƯỚC job này)
 */
async function getQueuePosition(_jobId: string, createdAt: Date): Promise<number> {
  const result = await db
    .select({ value: count() })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ['pending', 'processing']),
        lt(jobs.createdAt, createdAt),
      ),
    );
  return (result[0]?.value ?? 0) + 1; // +1 vì vị trí bắt đầu từ 1
}

// ─── Tạo job mới ──────────────────────────────────────────────────────────────

export async function createJob(userId: string, shopeeUrl: string) {
  // 1. Kiểm tra user có job đang chờ không (pending hoặc processing)
  const existingJob = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.status, ['pending', 'processing']),
      ),
    )
    .limit(1);

  if (existingJob.length > 0) {
    return {
      type: 'DUPLICATE_JOB' as const,
      existingJobId: existingJob[0].id,
    };
  }

  // 2. Bóc ID sản phẩm từ URL.
  //
  // Link rút gọn không chứa ID nên `parsed` sẽ là null — job vẫn tạo bình
  // thường, worker tự giải link bằng cách đi theo chuyển hướng (xem
  // automation/shopeeLink.ts).
  //
  // KHÔNG có bước "fetch thông tin sản phẩm" ở đây nữa: bước đó trước kia là
  // mock trả tên và ảnh bịa ra (xem services/shopee.ts). Tên và ảnh để null cho
  // tới khi có tích hợp thật.
  const parsed = parseShopeeUrl(shopeeUrl);

  // 3. Tính vị trí hàng đợi hiện tại (trước khi insert)
  const activeCount = await countActiveJobs();

  // 4. Insert job vào database.
  //    Chỉ ghi thứ thật sự biết: ID bóc từ chính URL người dùng gửi. Tên và ảnh
  //    để null — chưa có nguồn dữ liệu thật nào cho hai trường này.
  const [newJob] = await db
    .insert(jobs)
    .values({
      userId,
      shopeeUrl,
      shopeeProductId: parsed?.productId ?? null,
      shopeeProductName: null,
      shopeeProductImage: null,
      status: 'pending',
    })
    .returning();

  const queuePosition = activeCount + 1; // job này là cuối hàng đợi
  const estimatedWaitSeconds = queuePosition * config.AVG_JOB_SECONDS;

  // 5. Đẩy job vào hàng đợi BullMQ.
  //    KHÔNG được nuốt lỗi ở đây: job không vào được hàng đợi thì sẽ không bao
  //    giờ được xử lý, mà người dùng vẫn nhận job_id và ngồi chờ vô hạn. Phải
  //    đánh dấu thất bại ngay và báo ra để tầng trên trả lỗi.
  try {
    await addJobToQueue({
      jobId: newJob.id,
      shopeeUrl,
      shopeeProductId: newJob.shopeeProductId,
      userId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[JobService] Không đẩy được job vào hàng đợi:', message);

    await db
      .update(jobs)
      .set({
        status: 'failed',
        errorMessage: `Không đưa được vào hàng đợi: ${message}`,
      })
      .where(eq(jobs.id, newJob.id));

    return { type: 'QUEUE_ERROR' as const, message };
  }

  return {
    type: 'CREATED' as const,
    job: newJob,
    queuePosition,
    estimatedWaitSeconds,
  };
}

// ─── Lấy thông tin 1 job ──────────────────────────────────────────────────────

export async function getJobById(jobId: string): Promise<JobDetailResponse | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

  if (!job) return null;

  // Tính vị trí hàng đợi nếu job đang chờ
  let queuePosition: number | null = null;
  let estimatedWaitSeconds: number | null = null;

  if (job.status === 'pending' || job.status === 'processing') {
    queuePosition = await getQueuePosition(job.id, job.createdAt);
    estimatedWaitSeconds = queuePosition * config.AVG_JOB_SECONDS;
  }

  const result = job.status === 'done' ? await getJobResult(job.id) : null;
  return formatJobResponse(job, queuePosition, estimatedWaitSeconds, result);
}

// ─── Lấy danh sách jobs của user ─────────────────────────────────────────────

export async function getJobsByUser(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<{ jobs: JobDetailResponse[]; total: number }> {
  const [userJobs, totalResult] = await Promise.all([
    db
      .select()
      .from(jobs)
      .where(eq(jobs.userId, userId))
      .orderBy(jobs.createdAt)
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(jobs).where(eq(jobs.userId, userId)),
  ]);

  const formatted = await Promise.all(
    userJobs.map(async (job) => {
      let queuePosition: number | null = null;
      let estimatedWaitSeconds: number | null = null;

      if (job.status === 'pending' || job.status === 'processing') {
        queuePosition = await getQueuePosition(job.id, job.createdAt);
        estimatedWaitSeconds = queuePosition * config.AVG_JOB_SECONDS;
      }

      const result = job.status === 'done' ? await getJobResult(job.id) : null;
      return formatJobResponse(job, queuePosition, estimatedWaitSeconds, result);
    }),
  );

  return {
    jobs: formatted,
    total: totalResult[0]?.value ?? 0,
  };
}

// ─── Helper: Format job thành response ───────────────────────────────────────

function formatJobResponse(
  job: typeof jobs.$inferSelect,
  queuePosition: number | null,
  estimatedWaitSeconds: number | null,
  result: JobResult | null,
): JobDetailResponse {
  // Job xong nhưng Redis không còn kết quả nghĩa là link đã quá hạn TTL
  const expired = job.status === 'done' && result === null;

  return {
    job_id: job.id,
    status: job.status,
    product: {
      id: job.shopeeProductId,
      name: job.shopeeProductName,
      image: job.shopeeProductImage,
      original_url: job.shopeeUrl,
    },
    result:
      job.status === 'done' && result
        ? {
            affiliate_url: result.affiliateUrl,
            voucher: result.voucher || null,
            expires_at: result.expiresAt,
          }
        : null,
    result_expired: expired,
    queue_position: queuePosition,
    estimated_wait_seconds: estimatedWaitSeconds,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    completed_at: job.completedAt?.toISOString() ?? null,
    error_message: job.errorMessage,
  };
}
