-- ============================================================
-- Init SQL cho PostgreSQL
-- Chạy tự động khi container khởi động lần đầu
-- ============================================================

-- Enum trạng thái job
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'done', 'failed');

-- Bảng chính chứa toàn bộ job
CREATE TABLE IF NOT EXISTS jobs (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              VARCHAR(255) NOT NULL,
  shopee_url           TEXT         NOT NULL,
  shopee_product_id    VARCHAR(255),
  shopee_product_name  VARCHAR(500),
  shopee_product_image TEXT,
  status               job_status   NOT NULL DEFAULT 'pending',
  result_url           TEXT,
  result_voucher       VARCHAR(100),
  error_message        TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);

-- Index để query nhanh theo user + status
CREATE INDEX IF NOT EXISTS idx_jobs_user_id_status
  ON jobs(user_id, status);

-- Index để tính queue position (sort theo thời gian tạo)
CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
  ON jobs(status, created_at);

-- Trigger tự động cập nhật updated_at khi có thay đổi
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
