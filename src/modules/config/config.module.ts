// Що це: глобальний модуль, який один раз валідує env і віддає AppConfig через DI.
// Чому: якщо бракує JWT_SECRET або DATABASE_URL, краще впасти на старті з ясним текстом,
// ніж отримати дивну помилку у випадковому запиті через годину.
// Хто викликає: AppModule і WorkerModule імпортують його; сервіси інжектять APP_CONFIG.
import { Global, Module } from '@nestjs/common';
import { AppConfig, configSchema } from './config.schema';

export const APP_CONFIG = 'APP_CONFIG';

const REQUIRED_HINTS: Record<string, string> = {
  DATABASE_URL: 'Рядок підключення до PostgreSQL, напр. postgres://devhub:devhub@localhost:5432/devhub',
  JWT_SECRET: 'Секрет для підпису JWT, мінімум 16 символів. Згенеруй: openssl rand -hex 32',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (result.success) {
    return result.data;
  }
  const lines: string[] = ['Застосунок не може стартувати: помилки у змінних оточення.'];
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '?');
    const hint = REQUIRED_HINTS[key] ? ` Підказка: ${REQUIRED_HINTS[key]}` : '';
    lines.push(`  ${key}: ${issue.message}.${hint}`);
  }
  lines.push('Див. .env.example у корені проєкту.');
  throw new Error(lines.join('\n'));
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
