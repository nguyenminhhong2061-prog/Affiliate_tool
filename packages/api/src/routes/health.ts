import type { FastifyInstance } from 'fastify';
import { checkDbHealth } from '../db/client';
import { checkRedisHealth } from '../redis';

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        description: 'Health check endpoint',
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              db: { type: 'string' },
              redis: { type: 'string' },
              uptime_seconds: { type: 'number' },
              timestamp: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              db: { type: 'string' },
              redis: { type: 'string' },
              uptime_seconds: { type: 'number' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const [dbOk, redisOk] = await Promise.all([
        checkDbHealth(),
        checkRedisHealth(),
      ]);

      const allOk = dbOk && redisOk;

      return reply.status(allOk ? 200 : 503).send({
        status: allOk ? 'ok' : 'degraded',
        db: dbOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    },
  );
}
