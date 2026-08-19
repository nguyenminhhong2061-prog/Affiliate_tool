/**
 * Checkpoint tiến độ của job, lưu trong Redis.
 *
 * VÌ SAO CẦN: BullMQ retry job 3 lần. Nếu job thất bại SAU khi đã bấm "Đăng"
 * (ví dụ lỗi ở bước đọc clipboard lấy link chia sẻ), lần chạy lại sẽ thực hiện
 * lại toàn bộ Phase 1 và **gắn sản phẩm lần thứ hai** vào bộ sưu tập của người
 * dùng. Đây là lỗi làm hỏng dữ liệu thật, không tự phục hồi được.
 *
 * Cách xử lý: sau khi Phase 1 hoàn tất (đã Đăng), ghi checkpoint kèm thông tin
 * Phase 2 cần. Lần retry đọc thấy checkpoint thì bỏ qua Phase 1, chạy thẳng
 * Phase 2 để lấy link.
 */
import { redis } from '../redis';

/** Giữ 24 giờ — dài hơn nhiều so với tổng thời gian retry của BullMQ */
const CHECKPOINT_TTL_SECONDS = 86400;

export interface JobCheckpoint {
  /** Sản phẩm đã được gắn và ĐÃ ĐĂNG thành công */
  published: true;
  /** Bộ sưu tập đã gắn vào — Phase 2 cần để mở đúng thẻ lấy link chia sẻ */
  collectionName: string;
  /** Tên sản phẩm đã gắn — cần để tìm đúng link affiliate trên trang bộ sưu tập */
  productName: string;
  /** Thời điểm ghi checkpoint (ISO) */
  publishedAt: string;
}

function key(jobId: string): string {
  return `job:checkpoint:${jobId}`;
}

/** Ghi checkpoint ngay sau khi bấm "Đăng" thành công */
export async function markPublished(
  jobId: string,
  collectionName: string,
  productName: string,
): Promise<void> {
  const payload: JobCheckpoint = {
    published: true,
    collectionName,
    productName,
    publishedAt: new Date().toISOString(),
  };
  await redis.set(key(jobId), JSON.stringify(payload), 'EX', CHECKPOINT_TTL_SECONDS);
}

/** Đọc checkpoint. Trả null nếu job chưa từng đăng thành công. */
export async function getCheckpoint(jobId: string): Promise<JobCheckpoint | null> {
  const raw = await redis.get(key(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobCheckpoint;
  } catch {
    return null;
  }
}

/** Xoá checkpoint khi job đã hoàn tất trọn vẹn (không còn khả năng retry) */
export async function clearCheckpoint(jobId: string): Promise<void> {
  await redis.del(key(jobId));
}
