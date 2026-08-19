import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createJob, getJobById, getJobsByUser } from '../services/job';
import { isValidShopeeUrl } from '../services/shopee';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const CreateJobBody = z.object({
  shopee_url: z
    .string({ required_error: 'shopee_url là bắt buộc' })
    .url('shopee_url phải là URL hợp lệ')
    .refine(isValidShopeeUrl, {
      message: 'URL phải là link Shopee hợp lệ (shopee.vn hoặc shope.ee)',
    }),
  user_id: z
    .string({ required_error: 'user_id là bắt buộc' })
    .min(1, 'user_id không được để trống')
    .max(255, 'user_id quá dài'),
});

const GetJobParams = z.object({
  id: z.string().uuid('Job ID phải là UUID hợp lệ'),
});

const GetJobsQuery = z.object({
  user_id: z.string().min(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// ─── Helper: format thời gian chờ sang dạng đọc được ─────────────────────────

function formatWaitTime(seconds: number): string {
  // Dưới 2 phút thì nói bằng giây.
  //
  // Bản trước đổi sang phút ngay từ 60 giây và làm tròn LÊN, nên một job 75 giây
  // hiện ra là "~2 phút" — thừa 60%. Chuyện đó vô hại khi job còn mất 120 giây,
  // nhưng sau đợt tối ưu 2026-08-16 job chỉ còn ~70 giây, và lúc đó phần lớn ước
  // tính rơi đúng vào vùng bị làm tròn hỏng. Ước tính sai theo hướng nào cũng là
  // sai (CLAUDE.md §10.6).
  if (seconds < 120) return `~${seconds} giây`;

  // Từ 2 phút trở lên: làm tròn tới phút gần nhất thay vì luôn làm tròn lên.
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} phút`;

  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return remainMin > 0 ? `~${hours} giờ ${remainMin} phút` : `~${hours} giờ`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function jobRoutes(app: FastifyInstance) {
  // ── POST /jobs ─ Tạo job mới ──────────────────────────────────────────────
  app.post('/jobs', async (req, reply) => {
    // Validate body
    const parseResult = CreateJobBody.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: parseResult.error.errors.map((e) => e.message).join('; '),
      });
    }

    const { shopee_url, user_id } = parseResult.data;

    try {
      const result = await createJob(user_id, shopee_url);

      if (result.type === 'QUEUE_ERROR') {
        return reply.status(503).send({
          error: 'QUEUE_UNAVAILABLE',
          message:
            'Hệ thống hàng đợi đang không sẵn sàng, job chưa được tiếp nhận. Vui lòng thử lại sau ít phút.',
        });
      }

      if (result.type === 'DUPLICATE_JOB') {
        return reply.status(409).send({
          error: 'DUPLICATE_JOB',
          message: 'Bạn đang có 1 job chưa hoàn thành. Vui lòng chờ kết quả trước khi gửi link mới.',
          existing_job_id: result.existingJobId,
        });
      }

      // Thành công
      return reply.status(201).send({
        job_id: result.job.id,
        status: result.job.status,
        queue_position: result.queuePosition,
        estimated_wait_seconds: result.estimatedWaitSeconds,
        message: `Job đã được tạo. Ước tính ${formatWaitTime(result.estimatedWaitSeconds)} để xử lý.`,
        product: {
          id: result.job.shopeeProductId,
          name: result.job.shopeeProductName,
          image: result.job.shopeeProductImage,
        },
      });
    } catch (err) {
      req.log.error(err, '[POST /jobs] Lỗi tạo job');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Đã xảy ra lỗi khi tạo job. Vui lòng thử lại.',
      });
    }
  });

  // ── GET /jobs/:id ─ Lấy trạng thái job ────────────────────────────────────
  app.get<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
    const parseResult = GetJobParams.safeParse(req.params);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Job ID không hợp lệ',
      });
    }

    try {
      const job = await getJobById(parseResult.data.id);

      if (!job) {
        return reply.status(404).send({
          error: 'JOB_NOT_FOUND',
          message: `Không tìm thấy job với ID: ${parseResult.data.id}`,
        });
      }

      return reply.send(job);
    } catch (err) {
      req.log.error(err, '[GET /jobs/:id] Lỗi lấy job');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Đã xảy ra lỗi. Vui lòng thử lại.',
      });
    }
  });

  // ── GET /jobs ─ Danh sách jobs của user ───────────────────────────────────
  app.get('/jobs', async (req, reply) => {
    const parseResult = GetJobsQuery.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Cần truyền user_id hợp lệ',
      });
    }

    const { user_id, limit, offset } = parseResult.data;

    try {
      const result = await getJobsByUser(user_id, limit, offset);
      return reply.send({
        jobs: result.jobs,
        total: result.total,
        limit,
        offset,
      });
    } catch (err) {
      req.log.error(err, '[GET /jobs] Lỗi lấy danh sách job');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Đã xảy ra lỗi. Vui lòng thử lại.',
      });
    }
  });
}
