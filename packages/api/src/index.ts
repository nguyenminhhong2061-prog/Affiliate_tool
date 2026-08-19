import Fastify from 'fastify';
import cors from '@fastify/cors';
import { redis } from './redis';
import { config } from './config';
import { healthRoutes } from './routes/health';
import { jobRoutes } from './routes/jobs';
import { setupDashboard } from './routes/dashboard';
import { initWorker } from './queue/worker';
import { closeOcr } from './automation/ocr';
import {
  disposeSharedAppiumSession,
  nhaSessionGiuTrenServer,
  warmUpAppiumSession,
} from './automation/appiumYoutubeStudio';

// ─── Fastify App ──────────────────────────────────────────────────────────────
const app = Fastify({
  logger: {
    level: config.isDev ? 'info' : 'warn',
    transport: config.isDev
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

async function start() {
  // CORS — cho phép mobile app gọi API
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ioredis tự kết nối khi khởi tạo — chỉ cần xác nhận đã thông.
  // Nếu Redis chết thì job không vào được hàng đợi, nên phải biết ngay lúc khởi động.
  try {
    await redis.ping();
    app.log.info('[Redis] Đã kết nối thành công');
  } catch (err) {
    app.log.error('[Redis] KHÔNG kết nối được — job sẽ không vào được hàng đợi!');
  }

  // Routes
  await app.register(healthRoutes);
  await app.register(jobRoutes, { prefix: '/api/v1' });

  // Dashboard Bull Board UI
  await setupDashboard(app);

  // Khởi tạo BullMQ Worker (Concurrency: 1)
  initWorker();

  // Start server
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`🚀 API đang chạy tại http://0.0.0.0:${config.PORT}`);
    app.log.info(`📋 Health check: http://0.0.0.0:${config.PORT}/health`);
    app.log.info(`📊 Bull Board UI: http://0.0.0.0:${config.PORT}/admin/queues`);
    app.log.info(`⏱  Thời gian ước tính/job: ${config.AVG_JOB_SECONDS}s`);

    // Hâm nóng session Appium ngay khi server sẵn sàng.
    //
    // KHÔNG await: dựng session mất 10-15 giây, và server phải nhận request được
    // ngay. Job đầu tiên tới trong lúc đang hâm sẽ tự chờ đúng chỗ cần chờ
    // (xem `dangDungSession` trong appiumYoutubeStudio.ts).
    //
    // Không bao giờ ném lỗi ra ngoài: thiếu thiết bị chỉ là mất phần hâm nóng.
    void warmUpAppiumSession();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`[${signal}] Đang dừng server...`);
  await app.close();
  // Worker OCR được giữ ấm suốt vòng đời tiến trình — phải tắt khi dừng
  await closeOcr();
  // Session Appium: KHÔNG xoá, chỉ nhả tham chiếu.
  //
  // Xoá ở đây nghe như dọn dẹp đúng đắn, nhưng nó đánh đổi sai: mỗi lần khởi
  // động lại tiến trình — ts-node-dev nạp lại khi sửa file, triển khai bản mới,
  // hay chỉ là restart thường — job đầu tiên sau đó phải trả 11-14 giây dựng lại
  // một session mà lẽ ra vẫn còn dùng được nguyên vẹn.
  //
  // Giữ lại thì lần khởi động sau `init()` nối lại qua `appiumSessionStore`.
  // Lưới cuối vẫn nguyên: `newCommandTimeout` 3600s tự dọn nếu không ai quay lại.
  //
  // Đặt APPIUM_DISPOSE_ON_EXIT=1 để quay về hành vi cũ (khi cần trả thiết bị cho
  // việc khác, hoặc lúc gỡ rối muốn chắc chắn mỗi lần chạy là hoàn toàn mới).
  if (process.env.APPIUM_DISPOSE_ON_EXIT === '1') {
    await disposeSharedAppiumSession();
  } else {
    nhaSessionGiuTrenServer();
    app.log.info('[Appium] Giữ session trên server để lần khởi động sau nối lại.');
  }
  redis.disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
