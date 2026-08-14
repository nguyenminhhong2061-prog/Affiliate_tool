// ─── Types dùng chung trong toàn bộ API ──────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface ShopeeProduct {
  productId: string;
  name: string;
  imageUrl: string;
  originalUrl: string;
}

// Response của POST /jobs
export interface CreateJobResponse {
  job_id: string;
  status: JobStatus;
  queue_position: number;
  estimated_wait_seconds: number;
  message: string;
}

// Response của GET /jobs/:id
export interface JobDetailResponse {
  job_id: string;
  status: JobStatus;
  product: {
    id: string | null;
    name: string | null;
    image: string | null;
    original_url: string;
  };
  result: {
    affiliate_url: string | null;
    voucher: string | null;
  } | null;
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_message: string | null;
}

// Response của GET /jobs (danh sách)
export interface JobListResponse {
  jobs: JobDetailResponse[];
  total: number;
  limit: number;
  offset: number;
}

// Lỗi chuẩn của API
export interface ApiError {
  error: string;
  message: string;
  existing_job_id?: string;
}
