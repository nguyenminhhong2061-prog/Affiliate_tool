import Fastify from 'fastify';
import cors from '@fastify/cors';
import { redis } from './redis';
import { config } from './config';
import { healthRoutes } from './routes/health';
import { jobRoutes } from './routes/jobs';
import { setupDashboard } from './routes/dashboard';
import { initWorker } from './queue/worker';

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

  // Connect Redis
  try {
    await redis.connect();
    app.log.info('[Redis] Đã kết nối thành công');
  } catch (err) {
    app.log.warn('[Redis] Không kết nối được ngay — sẽ thử lại tự động');
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
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`[${signal}] Đang dừng server...`);
  await app.close();
  redis.disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
