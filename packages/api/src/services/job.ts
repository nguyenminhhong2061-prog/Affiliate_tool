import { eq, and, inArray, lt, count } from 'drizzle-orm';
import { db } from '../db/client';
import { jobs } from '../db/schema';
import { parseShopeeUrl, fetchShopeeProduct } from './shopee';
import { addJobToQueue } from '../queue/queue';
import { config } from '../config';
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

  // 2. Parse Shopee URL
  const parsed = parseShopeeUrl(shopeeUrl);
  // Nếu không parse được, vẫn tạo job nhưng không có product info
  // (automation worker sẽ tự xử lý)

  // 3. Fetch thông tin sản phẩm (mock hoặc API thật)
  let productInfo = null;
  if (parsed) {
    try {
      productInfo = await fetchShopeeProduct(shopeeUrl, parsed.productId, parsed.sellerId);
    } catch (err) {
      // Không fail nếu fetch product thất bại — job vẫn tạo được
      console.warn('[JobService] Không fetch được product info:', err);
    }
  }

  // 4. Tính vị trí hàng đợi hiện tại (trước khi insert)
  const activeCount = await countActiveJobs();

  // 5. Insert job vào database
  const [newJob] = await db
    .insert(jobs)
    .values({
      userId,
      shopeeUrl,
      shopeeProductId: productInfo?.productId ?? parsed?.productId ?? null,
      shopeeProductName: productInfo?.name ?? null,
      shopeeProductImage: productInfo?.imageUrl ?? null,
      status: 'pending',
    })
    .returning();

  const queuePosition = activeCount + 1; // job này là cuối hàng đợi
  const estimatedWaitSeconds = queuePosition * config.AVG_JOB_SECONDS;

  // 6. Đẩy job vào hàng đợi BullMQ
  try {
    await addJobToQueue({
      jobId: newJob.id,
      shopeeUrl,
      shopeeProductId: newJob.shopeeProductId,
      userId,
    });
  } catch (err) {
    console.error('[JobService] Lỗi khi đẩy job vào BullMQ queue:', err);
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

  return formatJobResponse(job, queuePosition, estimatedWaitSeconds);
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

      return formatJobResponse(job, queuePosition, estimatedWaitSeconds);
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
): JobDetailResponse {
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
      job.status === 'done'
        ? {
            affiliate_url: job.resultUrl,
            voucher: job.resultVoucher,
          }
        : null,
    queue_position: queuePosition,
    estimated_wait_seconds: estimatedWaitSeconds,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    completed_at: job.completedAt?.toISOString() ?? null,
    error_message: job.errorMessage,
  };
}
