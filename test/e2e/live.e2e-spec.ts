// e2e: WebSocket /live через socket.io-client. JWT у handshake, presence, дошка, прогрес звіту.
import { io, Socket } from 'socket.io-client';
import { TestApp, TestUser, createTestApp, registerUser, bearer, waitFor, sleep } from '../helpers/app';

function connect(t: TestApp, token: string, displayName: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`${t.baseUrl}/live`, { auth: { token, displayName }, transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe('live (e2e)', () => {
  let t: TestApp;
  let olena: TestUser;
  let taras: TestUser;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp({ withWorker: true });
    olena = await registerUser(t, 'olena@test.local');
    taras = await registerUser(t, 'taras@test.local');
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await sleep(300); // дати серверу обробити disconnect-и до закриття Redis
    await t.close();
  });

  it('без валідного JWT з\'єднання одразу закривається', async () => {
    const socket = io(`${t.baseUrl}/live`, { auth: { token: 'bad' }, transports: ['websocket'], reconnection: false });
    const reason = await new Promise<string>((resolve) => {
      socket.on('disconnect', (r) => resolve(r));
    });
    expect(reason).toBe('io server disconnect');
  });

  it('presence: після підключення двох користувачів обидва в списку, після відключення одного лишається один', async () => {
    const a = await connect(t, olena.accessToken, 'Olena');
    sockets.push(a);
    const b = await connect(t, taras.accessToken, 'Taras');
    sockets.push(b);
    const list = await waitFor(async () => {
      const res = await new Promise<{ online: Array<{ displayName: string }> }>((resolve) => a.emit('presence:list', {}, resolve));
      return res.online.length === 2 ? res.online : null;
    }, 5000);
    expect(list.map((u) => u.displayName).sort()).toEqual(['Olena', 'Taras']);

    const updates: Array<{ online: Array<{ displayName: string }> }> = [];
    a.on('presence:update', (u: { online: Array<{ displayName: string }> }) => updates.push(u));
    b.disconnect();
    const update = await waitFor(async () => updates.find((u) => u.online.length === 1) ?? null, 5000);
    expect(update.online.map((u) => u.displayName)).toEqual(['Olena']);
  });

  it('board: draw від одного приходить іншому, історія віддається при join, clear очищує', async () => {
    const a = sockets[0];
    const b = await connect(t, taras.accessToken, 'Taras');
    sockets.push(b);
    await once(b, 'board:history');

    const received = once<{ userId: string; points: Array<{ x: number; y: number }> }>(b, 'board:draw');
    a.emit('board:draw', { color: '#f00', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
    const stroke = await received;
    expect(stroke.userId).toBe(olena.id);
    expect(stroke.points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);

    const c = await connect(t, taras.accessToken, 'Taras2');
    sockets.push(c);
    const history = await once<Array<{ points: unknown[] }>>(c, 'board:history');
    expect(history).toHaveLength(1);

    const cleared = once(b, 'board:clear');
    a.emit('board:clear');
    await cleared;
    const d = await connect(t, taras.accessToken, 'Taras3');
    sockets.push(d);
    expect(await once<unknown[]>(d, 'board:history')).toEqual([]);
  });

  it('report:progress приходить у кімнату користувача з воркера через Redis pub/sub', async () => {
    const a = sockets[0];
    const progress: number[] = [];
    const completed = new Promise<void>((resolve) => {
      a.on('report:progress', (e: { status: string; progress: number }) => {
        progress.push(e.progress);
        if (e.status === 'completed') resolve();
      });
    });
    await t.http().post('/reports').set(bearer(olena)).send({}).expect(202);
    await completed;
    expect(progress).toContain(100);
    expect(progress.length).toBeGreaterThanOrEqual(6);
  });
});
