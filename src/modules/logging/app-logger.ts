// Що це: маленький структурований логер. Один JSON на рядок, з requestId з контексту.
// Чому: у production логи читає машина (Loki, CloudWatch). JSON шукати легко, текст ні.
// Хто викликає: будь-який клас: new AppLogger('ІмʼяКласу'). Також Nest через app.useLogger().
import { LoggerService } from '@nestjs/common';
import { getRequestId } from './request-context';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const env = process.env.LOG_LEVEL as Level | undefined;
  if (env && env in LEVEL_ORDER) return env;
  return process.env.NODE_ENV === 'test' ? 'warn' : 'info';
}

export class AppLogger implements LoggerService {
  constructor(private readonly context: string = 'App') {}

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }
  info(message: unknown): void {
    this.write('info', message);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  error(message: unknown, errorOrContext?: unknown, context?: string): void {
    const extra: Record<string, unknown> = {};
    if (errorOrContext instanceof Error) {
      extra.err = { name: errorOrContext.name, message: errorOrContext.message, stack: errorOrContext.stack };
    } else if (typeof errorOrContext === 'string' && !context) {
      context = errorOrContext;
    }
    this.write('error', message, context, extra);
  }

  private write(level: Level, message: unknown, context?: string, extra: Record<string, unknown> = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel()]) return;
    const line = {
      time: new Date().toISOString(),
      level,
      context: context ?? this.context,
      requestId: getRequestId() ?? null,
      instance: process.env.INSTANCE_NAME ?? 'api',
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      ...extra,
    };
    const out = JSON.stringify(line);
    if (level === 'error') process.stderr.write(out + '\n');
    else process.stdout.write(out + '\n');
  }
}
