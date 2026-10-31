// Що це: спільний хелпер для int/e2e-тестів. Чиста БД (drop + migrations), чистий Redis (db 1),
// застосунок з тими самими пайпами і фільтром, що у main.ts, плюс воркер in-process (JobsWorkerModule).
// Читає .env.test через node --env-file-if-exists (див. package.json).
import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { JobsWorkerModule } from '../../src/modules/jobs/jobs-worker.module';
import { loadConfig } from '../../src/modules/config/config.module';
import { buildDataSourceOptions } from '../../src/modules/database/data-source-options';
import { entities } from '../../src/entities';
import { setupApp, setupOpenApi } from '../../src/app-setup';
import { AppLogger } from '../../src/modules/logging/app-logger';

export const config = loadConfig();

export async function resetDatabase(): Promise<DataSource> {
  const ds = new DataSource(buildDataSourceOptions(config, entities));
  await ds.initialize();
  await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await ds.runMigrations();
  return ds;
}

export async function resetRedis(): Promise<void> {
  const redis = new Redis(config.REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}

@Module({ imports: [AppModule, JobsWorkerModule] })
class TestRootModule {}

export interface TestApp {
  app: INestApplication;
  dataSource: DataSource;
  baseUrl: string;
  http: () => request.Agent;
  close: () => Promise<void>;
}

export async function createTestApp(options: { withWorker?: boolean } = {}): Promise<TestApp> {
  const setupDs = await resetDatabase();
  await setupDs.destroy();
  await resetRedis();

  const moduleRef = await Test.createTestingModule({ imports: [options.withWorker ? TestRootModule : AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: new AppLogger('Test') });
  setupApp(app, config.REDIS_URL);
  setupOpenApi(app);
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const dataSource = app.get(DataSource);
  return {
    app,
    dataSource,
    baseUrl,
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(t: TestApp, email: string, role: 'user' | 'admin' = 'user'): Promise<TestUser> {
  const res = await t.http().post('/auth/register').send({ email, password: 'password123', displayName: email.split('@')[0] }).expect(201);
  if (role === 'admin') {
    // Ролі нема в API реєстрації навмисно. У тестах підвищуємо напряму в БД і логінимось знову, щоб JWT мав role=admin.
    await t.dataSource.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [res.body.user.id]);
    const login = await t.http().post('/auth/login').send({ email, password: 'password123' }).expect(200);
    return { id: res.body.user.id, email, accessToken: login.body.tokens.accessToken, refreshToken: login.body.tokens.refreshToken };
  }
  return { id: res.body.user.id, email, accessToken: res.body.tokens.accessToken, refreshToken: res.body.tokens.refreshToken };
}

export function bearer(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.accessToken}` };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 15000, stepMs = 100): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: таймаут');
    await sleep(stepMs);
  }
}
