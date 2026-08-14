export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number; // Số lần lỗi liên tiếp để ngắt cầu chì (ví dụ 3 lần)
  resetTimeoutMs: number;    // Thời gian tạm dừng trước khi thử phục hồi (ms)
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private config: CircuitBreakerConfig = {
      failureThreshold: 3,
      resetTimeoutMs: 30000, // 30 giây
    },
  ) {}

  /**
   * Kiểm tra xem có thể thực hiện công việc tiếp theo hay không
   */
  public canExecute(): boolean {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.config.resetTimeoutMs) {
        console.log('[CircuitBreaker] 🟡 Đổi sang trạng thái HALF_OPEN (Đang thử phục hồi...)');
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Ghi nhận 1 lần xử lý THÀNH CÔNG
   */
  public recordSuccess(): void {
    if (this.state !== 'CLOSED') {
      console.log('[CircuitBreaker] 🟢 Phục hồi thành công! Chuyển về trạng thái CLOSED (Bình thường)');
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  /**
   * Ghi nhận 1 lần xử lý THẤT BẠI
   */
  public recordFailure(reason: string): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    console.warn(`[CircuitBreaker] ⚠️ Ghi nhận lỗi (${this.failureCount}/${this.config.failureThreshold}): ${reason}`);

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
      console.error(`[CircuitBreaker] 🚨 CẦU CHÌ ĐÃ NGẮT! Trạng thái OPEN. Tạm dừng worker trong ${this.config.resetTimeoutMs / 1000}s để bảo vệ tài khoản.`);
    }
  }

  public getState(): CircuitState {
    return this.state;
  }

  public getFailureCount(): number {
    return this.failureCount;
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

// Singleton Circuit Breaker instance cho Youtube Automation Worker
export const youtubeCircuitBreaker = new CircuitBreaker();
