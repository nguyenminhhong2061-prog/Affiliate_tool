import type { FastifyInstance } from 'fastify';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { youtubeQueue } from '../queue/queue';

export async function setupDashboard(app: FastifyInstance) {
  const serverAdapter = new FastifyAdapter();

  createBullBoard({
    queues: [new BullMQAdapter(youtubeQueue)],
    serverAdapter,
  });

  serverAdapter.setBasePath('/admin/queues');

  await app.register(serverAdapter.registerPlugin(), {
    prefix: '/admin/queues',
  });

  app.log.info('📊 [Bull Board] Dashboard quản trị hàng đợi sẵn sàng tại /admin/queues');
}
