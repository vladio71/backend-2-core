// Що це: socket.io namespace /live. JWT у handshake.auth.token, кімнати user:<id>, presence, board.
// Чому кімнати: emit у кімнату 'user:<id>' доходить до всіх вкладок цього користувача на будь-якому інстансі
// (завдяки Redis-адаптеру). Прогрес звіту приходить сюди з ReportEventsService (Redis pub/sub від воркера).
// Хто викликає: браузер через socket.io-client; ReportEventsService через підписку.
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { JwtService, AccessTokenPayload } from '../auth/jwt.service';
import { PresenceService } from './presence.service';
import { BoardService, Stroke, Point } from './board.service';
import { ReportEventsService } from '../jobs/report-events.service';
import { AppLogger } from '../logging/app-logger';

interface LiveSocket extends Socket {
  data: { user?: AccessTokenPayload; displayName?: string };
}

export interface DrawMessage {
  color: string;
  points: Point[];
}

// CORS для сокетів не задаємо в декораторі: він виконується при завантаженні файла, до DI, і конфігу ще нема.
// Дозволені origin береться з CORS_ORIGINS (як для HTTP у main.ts) в RedisIoAdapter.createIOServer.
@WebSocketGateway({ namespace: '/live' })
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new AppLogger('LiveGateway');
  private unsubscribe: (() => void) | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly presence: PresenceService,
    private readonly board: BoardService,
    private readonly reportEvents: ReportEventsService,
  ) {}

  onModuleInit(): void {
    // Подія від воркера -> кімната користувача. Кожен інстанс API робить це для своїх сокетів.
    this.unsubscribe = this.reportEvents.subscribe((event) => {
      this.server.to(`user:${event.userId}`).emit('report:progress', event);
    });
    this.heartbeat = setInterval(() => this.refreshPresence(), 10_000);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  async handleConnection(client: LiveSocket): Promise<void> {
    const token = typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : '';
    try {
      client.data.user = this.jwt.verify(token);
    } catch {
      // Без валідного JWT одразу відключаємо. Клієнт отримає подію 'disconnect'.
      client.emit('error', { code: 'UNAUTHORIZED', message: 'Потрібен JWT у handshake.auth.token' });
      client.disconnect(true);
      return;
    }
    const user = client.data.user;
    client.data.displayName = typeof client.handshake.auth?.displayName === 'string' ? client.handshake.auth.displayName : user.email;
    await client.join([`user:${user.sub}`, 'presence', 'board']);
    await this.presence.markOnline({ userId: user.sub, displayName: client.data.displayName });
    await this.broadcastPresence();
    client.emit('board:history', await this.board.history());
    this.logger.info(`WS connect ${user.email} (${process.env.INSTANCE_NAME ?? 'api'})`);
  }

  async handleDisconnect(client: LiveSocket): Promise<void> {
    const user = client.data.user;
    if (!user) return;
    try {
      await this.presence.markOffline(user.sub);
      await this.broadcastPresence();
    } catch (err) {
      // Під час зупинки процесу Redis може бути вже закритий. Це не помилка, яку треба комусь показувати.
      this.logger.debug(`disconnect після закриття Redis: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @SubscribeMessage('board:draw')
  async onDraw(@ConnectedSocket() client: LiveSocket, @MessageBody() message: DrawMessage): Promise<void> {
    const user = client.data.user;
    if (!user || !Array.isArray(message?.points) || message.points.length === 0) return;
    const stroke: Stroke = {
      userId: user.sub,
      color: typeof message.color === 'string' ? message.color.slice(0, 20) : '#000',
      points: message.points.slice(0, 500).map((p) => ({ x: Number(p.x), y: Number(p.y) })),
    };
    await this.board.append(stroke);
    // Усім у кімнаті, крім відправника (він уже намалював локально).
    client.to('board').emit('board:draw', stroke);
  }

  @SubscribeMessage('board:clear')
  async onClear(): Promise<void> {
    await this.board.clear();
    this.server.to('board').emit('board:clear');
  }

  @SubscribeMessage('presence:list')
  async onPresenceList(): Promise<{ online: Array<{ userId: string; displayName: string }> }> {
    return { online: await this.presence.list() };
  }

  private async broadcastPresence(): Promise<void> {
    this.server.to('presence').emit('presence:update', { online: await this.presence.list(), instance: process.env.INSTANCE_NAME ?? 'api' });
  }

  private async refreshPresence(): Promise<void> {
    const sockets = await this.server.local.fetchSockets();
    for (const s of sockets) {
      const data = s.data as LiveSocket['data'];
      if (data.user) await this.presence.heartbeat({ userId: data.user.sub, displayName: data.displayName ?? data.user.email });
    }
  }
}
