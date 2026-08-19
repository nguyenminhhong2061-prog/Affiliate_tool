/**
 * Lưu tạm kết quả job (link affiliate) trong Redis kèm thời hạn.
 *
 * Vì sao không lưu vào PostgreSQL: link affiliate do YouTube Shopping sinh ra có
 * hạn sử dụng — token ký thời gian bên trong sẽ hết hiệu lực. Lưu vĩnh viễn vào
 * DB sẽ khiến người dùng mở lại link cũ và gặp trang lỗi của Shopee. Redis + TTL
 * cho phép link tự biến mất đúng lúc, đồng thời vẫn đủ chỗ chứa để hàng đợi bất
 * đồng bộ trả kết quả về app khi worker xử lý xong.
 */
import { redis } from '../redis';

/** Thời hạn giữ link (giây). Mặc định 45 phút — đủ để người dùng nhận và mở. */
const RESULT_TTL_SECONDS = parseInt(process.env.RESULT_TTL_SECONDS ?? '2700', 10);

export interface JobResult {
  affiliateUrl: string;
  voucher: string;
  /** Mốc thời gian ISO khi link hết hạn — app dùng để hiển thị đếm ngược */
  expiresAt: string;
}

function key(jobId: string): string {
  return `job:result:${jobId}`;
}

/** Lưu kết quả kèm TTL. Trả về mốc hết hạn để ghi vào phản hồi cho người dùng. */
export async function saveJobResult(
  jobId: string,
  affiliateUrl: string,
  voucher: string,
): Promise<JobResult> {
  const expiresAt = new Date(Date.now() + RESULT_TTL_SECONDS * 1000).toISOString();
  const payload: JobResult = { affiliateUrl, voucher, expiresAt };

  await redis.set(key(jobId), JSON.stringify(payload), 'EX', RESULT_TTL_SECONDS);
  return payload;
}

/**
 * Đọc kết quả. Trả null khi đã hết hạn (hoặc chưa có) — tầng gọi phải phân biệt
 * "job chưa xong" với "job xong rồi nhưng link đã hết hạn" dựa vào status của job.
 */
export async function getJobResult(jobId: string): Promise<JobResult | null> {
  const raw = await redis.get(key(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobResult;
  } catch {
    return null;
  }
}

export function getResultTtlSeconds(): number {
  return RESULT_TTL_SECONDS;
}
