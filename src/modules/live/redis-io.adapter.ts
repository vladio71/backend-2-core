// Що це: адаптер socket.io, який через Redis pub/sub синхронізує кімнати між кількома інстансами API.
// Чому: без нього emit у кімнату 'board' на api-1 побачать тільки клієнти, підключені до api-1.
// З nginx round robin половина вкладок сидить на api-2 і нічого не отримає.
// Канали: @socket.io/redis-adapter публікує в канали з префіксом 'socket.io' (типово): 'socket.io#/live#' для
// широкомовлень namespace /live та 'socket.io-request#/live#' і 'socket.io-response#/live#' для службових запитів між
// інстансами. Redis один на весь стенд, тож ці канали спільні з усім, що на ньому сидить: будь-який інший socket.io-сервер
// з тим самим префіксом і namespace отримає наші події (і навпаки). Поруч ходить наш власний канал 'devhub:report-events'
// (jobs/queues.ts). Якщо Redis спільний з іншими застосунками, задай свій префікс: createAdapter(pub, sub, { key: 'devhub' }).
// Хто викликає: main.ts: app.useWebSocketAdapter(new RedisIoAdapter(app, redisUrl)).
import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, ServerOptions } from 'socket.io';
import { createRedis } from '../redis/redis.module';
import Redis from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';

export class RedisIoAdapter extends IoAdapter {
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private readonly corsOrigins: string[];

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly enabled: boolean = true,
  ) {
    super(app);
    this.corsOrigins = app.get<AppConfig>(APP_CONFIG).CORS_ORIGINS.split(',').map((o) => o.trim());
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Той самий список origin, що й для HTTP (CORS_ORIGINS). Раніше було origin: true, тобто будь-який сайт міг відкрити сокет.
    const server = super.createIOServer(port, { ...options, cors: { origin: this.corsOrigins, credentials: true } }) as Server;
    if (this.enabled) {
      // Два клієнти: один публікує, другий тільки слухає (підписаний клієнт не може робити інше).
      this.pubClient = createRedis(this.redisUrl);
      this.subClient = this.pubClient.duplicate();
      server.adapter(createAdapter(this.pubClient, this.subClient));
    }
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await this.pubClient?.quit().catch(() => undefined);
    await this.subClient?.quit().catch(() => undefined);
  }
}
