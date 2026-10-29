// Що це: адаптер socket.io, який через Redis pub/sub синхронізує кімнати між кількома інстансами API.
// Чому: без нього emit у кімнату 'board' на api-1 побачать тільки клієнти, підключені до api-1.
// З nginx round robin половина вкладок сидить на api-2 і нічого не отримає.
// Хто викликає: main.ts: app.useWebSocketAdapter(new RedisIoAdapter(app, redisUrl)).
import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, ServerOptions } from 'socket.io';
import { createRedis } from '../redis/redis.module';
import Redis from 'ioredis';

export class RedisIoAdapter extends IoAdapter {
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly enabled: boolean = true,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
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
