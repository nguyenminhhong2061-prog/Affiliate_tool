import { API_BASE_URL, API_PREFIX, REQUEST_TIMEOUT_MS } from './config';

// ─── Kiểu dữ liệu — khớp với packages/api/src/types/index.ts ──────────────────

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface JobDetail {
  job_id: string;
  status: JobStatus;
  /** Chỉ có khi job xong VÀ link còn hạn (link được giữ trong Redis kèm TTL) */
  result: {
    affiliate_url: string;
    voucher: string | null;
    expires_at: string;
  } | null;
  /** true = job đã xong nhưng link đã hết hạn → phải tạo job mới */
  result_expired: boolean;
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  error_message: string | null;
}

export interface CreatedJob {
  jobId: string;
  queuePosition: number | null;
  estimatedWaitSeconds: number | null;
  /** true = server báo đã có job đang chạy, app bám theo job cũ thay vì tạo mới */
  resumed: boolean;
}

// ─── Lỗi ──────────────────────────────────────────────────────────────────────

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

// ─── Gọi HTTP ─────────────────────────────────────────────────────────────────

interface ApiBody {
  error?: string;
  message?: string;
  existing_job_id?: string;
}

interface RawResponse {
  status: number;
  ok: boolean;
  body: ApiBody & Record<string, unknown>;
}

/**
 * Gọi API và trả về cả mã trạng thái lẫn body đã parse, KHÔNG tự ném lỗi theo
 * mã HTTP — vì 409 (đã có job đang chạy) là tình huống hợp lệ mà tầng trên cần
 * xử lý riêng chứ không phải lỗi.
 *
 * fetch của React Native không có timeout mặc định: không đặt thì khi sai IP
 * hoặc server tắt, app sẽ chờ vô hạn mà không báo gì.
 */
async function rawFetch(path: string, init?: RequestInit): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    // Ở tầng này không phân biệt được sai IP / server tắt / mất WiFi, nên nói rõ
    // địa chỉ đang gọi để người dùng tự đối chiếu.
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ApiRequestError(
      aborted
        ? `Server không phản hồi trong ${REQUEST_TIMEOUT_MS / 1000} giây (${API_BASE_URL}).`
        : `Không kết nối được tới server ${API_BASE_URL}. Kiểm tra điện thoại và máy chủ có cùng mạng WiFi không.`,
      'NETWORK_ERROR',
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body: ApiBody & Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiRequestError('Server trả về dữ liệu không đọc được.', 'BAD_RESPONSE');
    }
  }

  return { status: response.status, ok: response.ok, body };
}

/** Ném lỗi kèm thông báo tiếng Việt do chính API trả về */
function toError(res: RawResponse): ApiRequestError {
  return new ApiRequestError(
    res.body.message ?? `Server báo lỗi (HTTP ${res.status}).`,
    res.body.error ?? `HTTP_${res.status}`,
  );
}

// ─── Các lời gọi cụ thể ───────────────────────────────────────────────────────

/**
 * Tạo job mới.
 *
 * 409 DUPLICATE_JOB không phải lỗi đối với người dùng: nghĩa là họ đã có job
 * đang chạy (ví dụ vừa tắt app rồi mở lại). Server trả kèm id của job đó nên ta
 * bám theo luôn, thay vì bắt họ chờ mà không thấy gì.
 */
export async function createJob(userId: string, shopeeUrl: string): Promise<CreatedJob> {
  const res = await rawFetch('/jobs', {
    method: 'POST',
    body: JSON.stringify({ shopee_url: shopeeUrl, user_id: userId }),
  });

  if (res.status === 409 && typeof res.body.existing_job_id === 'string') {
    return {
      jobId: res.body.existing_job_id,
      queuePosition: null,
      estimatedWaitSeconds: null,
      resumed: true,
    };
  }

  if (!res.ok || typeof res.body.job_id !== 'string') {
    throw toError(res);
  }

  return {
    jobId: res.body.job_id,
    queuePosition: typeof res.body.queue_position === 'number' ? res.body.queue_position : null,
    estimatedWaitSeconds:
      typeof res.body.estimated_wait_seconds === 'number'
        ? res.body.estimated_wait_seconds
        : null,
    resumed: false,
  };
}

export async function getJob(jobId: string): Promise<JobDetail> {
  const res = await rawFetch(`/jobs/${jobId}`);
  if (!res.ok) throw toError(res);
  return res.body as unknown as JobDetail;
}
