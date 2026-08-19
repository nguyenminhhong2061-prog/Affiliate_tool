/**
 * Bộ đếm chi phí cho một lần chạy automation.
 *
 * VÌ SAO CẦN: CLAUDE.md §8 ghi lại một bài học đắt — đợt tối ưu trước dự đoán
 * tiết kiệm ~35 giây, thực tế đạt ~10,6 giây, vì hai khoản lớn nhất trong dự
 * đoán ("cắt vùng OCR", "giữ ấm Chromium") đều hỏng khi đem đi đo. Và §8 cũng
 * chỉ ra biên độ dao động giữa các lần chạy y hệt nhau lên tới ±4 giây, nên một
 * phép đo tổng thời gian KHÔNG phân biệt được thay đổi nhỏ.
 *
 * Cách thoát khỏi cái bẫy đó là đo từng khoản chi thay vì đo tổng: số lần OCR và
 * tổng thời gian OCR là con số xác định, không bị nhiễu bởi độ trễ mạng hay tốc
 * độ render của app. Nếu một tối ưu nhắm vào OCR mà số lần OCR không giảm thì
 * biết ngay là nó không chạm được vào thứ định chạm — không cần đo lại tổng.
 *
 * Chi phí của chính bộ đếm: một Map và Date.now(), không đáng kể so với các
 * thao tác đang đo (nhỏ nhất là ~150ms).
 */

interface Bucket {
  count: number;
  totalMs: number;
}

/** Mốc thời gian của một bước trong luồng — để biết bước nào ăn thời gian */
interface Mark {
  label: string;
  atMs: number;
}

class AutomationMetrics {
  private buckets = new Map<string, Bucket>();
  private marks: Mark[] = [];
  private startedAt: number | null = null;

  /** Bắt đầu đo một lần chạy. Gọi ở đầu job. */
  start(): void {
    this.buckets.clear();
    this.marks = [];
    this.startedAt = Date.now();
  }

  /** Đang đo hay không — dùng để bỏ qua chi phí khi chạy ngoài job */
  private get active(): boolean {
    return this.startedAt !== null;
  }

  /**
   * Bọc một thao tác để đo. Đếm cả số lần lẫn tổng thời gian.
   * Lỗi vẫn được đếm rồi ném tiếp — thao tác hỏng vẫn tốn thời gian thật.
   */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!this.active) return fn();

    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      const bucket = this.buckets.get(name) ?? { count: 0, totalMs: 0 };
      bucket.count += 1;
      bucket.totalMs += Date.now() - t0;
      this.buckets.set(name, bucket);
    }
  }

  /** Đánh dấu một mốc trong luồng (kết thúc một bước) */
  mark(label: string): void {
    if (!this.active || this.startedAt === null) return;
    this.marks.push({ label, atMs: Date.now() - this.startedAt });
  }

  /**
   * Bảng tổng kết. Trả chuỗi rỗng nếu chưa từng gọi start() — script CLI chạy
   * lẻ không cần bảng này.
   */
  report(): string {
    if (this.startedAt === null) return '';

    const totalMs = Date.now() - this.startedAt;
    const lines: string[] = [
      '',
      '  ┌─ CHI PHÍ LẦN CHẠY ─────────────────────────────────────────',
      `  │ Tổng: ${(totalMs / 1000).toFixed(1)}s`,
    ];

    const sorted = [...this.buckets.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
    if (sorted.length > 0) {
      lines.push('  │');
      lines.push('  │ Theo loại thao tác (xếp theo tổng thời gian):');
      for (const [name, b] of sorted) {
        const share = totalMs > 0 ? Math.round((b.totalMs / totalMs) * 100) : 0;
        lines.push(
          `  │   ${name.padEnd(22)} ${String(b.count).padStart(3)} lần  ` +
            `${(b.totalMs / 1000).toFixed(1).padStart(6)}s  (${share}%)`,
        );
      }
    }

    if (this.marks.length > 0) {
      lines.push('  │');
      lines.push('  │ Theo bước (thời điểm kết thúc, và thời lượng của bước):');
      let prev = 0;
      for (const m of this.marks) {
        const stepMs = m.atMs - prev;
        prev = m.atMs;
        lines.push(
          `  │   ${m.label.padEnd(30)} +${(stepMs / 1000).toFixed(1).padStart(5)}s  ` +
            `(mốc ${(m.atMs / 1000).toFixed(1)}s)`,
        );
      }
    }

    lines.push('  └────────────────────────────────────────────────────────────');
    return lines.join('\n');
  }

  /** In bảng tổng kết rồi dừng đo */
  finish(): void {
    const report = this.report();
    if (report) console.log(report);
    this.startedAt = null;
  }
}

export const metrics = new AutomationMetrics();
