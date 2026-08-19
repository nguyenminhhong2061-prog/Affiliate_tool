import { pgTable, uuid, varchar, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

// ─── Enum trạng thái job ──────────────────────────────────────────────────────
export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'processing',
  'done',
  'failed',
]);

// ─── Bảng jobs ────────────────────────────────────────────────────────────────
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Người dùng gửi job (chưa có auth, nhận từ client)
  // TODO: Giai đoạn sau cần xác thực user_id bằng JWT/Firebase
  userId: varchar('user_id', { length: 255 }).notNull(),

  // Link Shopee gốc
  shopeeUrl: text('shopee_url').notNull(),

  // Thông tin sản phẩm parse được (hoặc mock)
  shopeeProductId: varchar('shopee_product_id', { length: 255 }),
  shopeeProductName: varchar('shopee_product_name', { length: 500 }),
  shopeeProductImage: text('shopee_product_image'),

  // Trạng thái job
  status: jobStatusEnum('status').notNull().default('pending'),

  // CHÚ Ý: link affiliate KHÔNG lưu ở đây. Link do YouTube Shopping sinh ra có
  // hạn sử dụng, lưu vĩnh viễn sẽ khiến người dùng mở lại và gặp trang lỗi.
  // Kết quả được giữ tạm trong Redis kèm TTL — xem services/jobResult.ts

  // Lý do lỗi (chỉ có khi status = 'failed')
  errorMessage: text('error_message'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
