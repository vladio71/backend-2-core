// Що це: кореневий модуль API. Збирає всі feature-модулі. Порядок імпортів має значення для маршрутів
// з однаковим префіксом (AiModule з /posts/similar стоїть перед PostsModule з /posts/:id).
// Хто викликає: main.ts (HTTP) і e2e-тести.
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, APP_CONFIG } from './modules/config/config.module';
import { AppConfig } from './modules/config/config.schema';
import { LoggingModule } from './modules/logging/logging.module';
import { RequestIdMiddleware } from './modules/logging/request-id.middleware';
import { DatabaseModule } from './modules/database/database.module';
import { entities } from './entities';
import { RedisModule } from './modules/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { QueriesModule } from './modules/queries/queries.module';
import { AiModule } from './modules/ai/ai.module';
import { PostsModule } from './modules/posts/posts.module';
import { PoolModule } from './modules/pool/pool.module';
import { CreditsModule } from './modules/credits/credits.module';
import { RatelimitModule } from './modules/ratelimit/ratelimit.module';
import { GithubModule } from './modules/github/github.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { LiveModule } from './modules/live/live.module';
import { SecurityModule } from './modules/security/security.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { loadConfig } from './modules/config/config.module';
import { redisConnectionFromUrl } from './modules/redis/redis-connection';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule.forRoot(entities),
    RedisModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ connection: redisConnectionFromUrl(config.REDIS_URL), prefix: 'devhub' }),
    }),
    HealthModule,
    MetricsModule, // GET /metrics для Prometheus і лічильники HTTP (див. docs/observability.md)
    UsersModule,
    AuthModule,
    QueriesModule, // /reports/posts-per-day перед /reports/:id (JobsModule)
    AiModule, // /posts/similar перед /posts/:id (PostsModule)
    PostsModule,
    PoolModule,
    CreditsModule,
    RatelimitModule,
    GithubModule,
    JobsModule,
    LiveModule,
    SecurityModule.forEnv(loadConfig().NODE_ENV),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
