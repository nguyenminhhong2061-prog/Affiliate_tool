// ─── Types dùng chung trong toàn bộ API ──────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

// ĐÃ GỠ: `ShopeeProduct` — kiểu trả về của mock `fetchShopeeProduct()`, hàm sinh
// tên và ảnh sản phẩm bịa ra. Xem services/shopee.ts. Khi nào tích hợp Shopee
// Affiliate Open API thật thì dựng lại kiểu này, đừng dựng lại cái mock.

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
    /** Bóc từ chính URL người dùng gửi. Null với link rút gọn (chưa giải được ở tầng API). */
    id: string | null;
    /** LUÔN null cho tới khi có tích hợp Shopee API thật — xem services/shopee.ts */
    name: string | null;
    /** LUÔN null cho tới khi có tích hợp Shopee API thật */
    image: string | null;
    original_url: string;
  };
  /**
   * Chỉ có khi job đã xong VÀ link còn hạn. Link affiliate có thời hạn nên được
   * lưu tạm trong Redis; hết hạn thì trường này về null và `result_expired`
   * chuyển thành true.
   */
  result: {
    affiliate_url: string;
    voucher: string | null;
    expires_at: string;
  } | null;
  /** true = job đã xong nhưng link đã hết hạn, người dùng cần tạo job mới */
  result_expired: boolean;
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
