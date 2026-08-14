import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config';
import * as schema from './schema';

// Tạo postgres connection pool
const queryClient = postgres(config.DATABASE_URL, {
  max: 10,           // tối đa 10 connections trong pool
  idle_timeout: 20,  // đóng connection sau 20s không dùng
  connect_timeout: 10,
});

// Drizzle client với type-safe schema
export const db = drizzle(queryClient, { schema });

// Health check: thử query đơn giản
export async function checkDbHealth(): Promise<boolean> {
  try {
    await queryClient`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
