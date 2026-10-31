// Живе: socket.io /live. Presence (хто онлайн), дошка на canvas (board:draw пачками по 16 мс, board:history при вході, board:clear).
import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { useAuth } from '../api/auth';
import { connectLive } from '../api/live';
import { PanelFooter, Topic } from '../components/TopicParts';
import { Card, NeedAuth, PageTitle } from '../components/common';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  userId?: string;
  color: string;
  points: Point[];
}

interface PresenceUpdate {
  online: Array<{ userId: string; displayName: string }>;
  instance: string;
}

const COLORS = ['#2a62d9', '#c92a2a', '#1f8a4c', '#b86e00', '#5a3ec8', '#0e7c86'];
const BOARD_W = 700;
const BOARD_H = 400;

export function LivePage() {
  const auth = useAuth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const drawingRef = useRef(false);
  const bufferRef = useRef<Point[]>([]);
  const carriedRef = useRef(false);
  const colorRef = useRef(COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<PresenceUpdate | null>(null);
  const [received, setReceived] = useState(0);
  const [sent, setSent] = useState(0);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function addLog(line: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString('uk-UA')} ${line}`, ...prev].slice(0, 12));
  }

  function drawStroke(stroke: Stroke) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || stroke.points.length === 0) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x + 0.5, stroke.points[0].y + 0.5);
    ctx.stroke();
  }

  function clearCanvas() {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  }

  useEffect(() => {
    if (!auth.tokens) return;
    let socket: Socket | null = null;
    let flush: number | null = null;
    let cancelled = false;
    void connectLive().then((s) => {
      if (cancelled) {
        s.disconnect();
        return;
      }
      socket = s;
      attach(s);
    });

    function attach(socket: Socket) {
      socketRef.current = socket;
      socket.on('connect', () => {
        setConnected(true);
        setError(null);
        addLog(`connect, socket.id ${socket.id}`);
      });
      socket.on('disconnect', (reason: string) => {
        setConnected(false);
        addLog(`disconnect: ${reason}`);
      });
      socket.on('connect_error', (err: Error) => setError(`connect_error: ${err.message}`));
      socket.on('error', (payload: { code?: string; message?: string }) => setError(`${payload.code ?? 'error'}: ${payload.message ?? ''}`));
      socket.on('presence:update', (payload: PresenceUpdate) => {
        setOnline(payload);
        addLog(`presence:update: ${payload.online.length} онлайн, instance ${payload.instance}`);
      });
      socket.on('board:history', (strokes: Stroke[]) => {
        clearCanvas();
        for (const s of strokes) drawStroke(s);
        setHistoryCount(strokes.length);
        addLog(`board:history: ${strokes.length} штрихів`);
      });
      socket.on('board:draw', (stroke: Stroke) => {
        drawStroke(stroke);
        setReceived((n) => n + 1);
      });
      socket.on('board:clear', () => {
        clearCanvas();
        addLog('board:clear');
      });

      // Пачка точок кожні 16 мс (один кадр): одна подія замість десятків на кожен mousemove.
      flush = window.setInterval(() => {
        const buffer = bufferRef.current;
        if (buffer.length === 0) return;
        // Поки малюємо, чекаємо хоча б на 2 точки (відрізок). Остання точка переходить у наступну пачку,
        // щоб на дошці іншої вкладки лінія була суцільною, а не пунктиром.
        if (drawingRef.current && buffer.length < 2) return;
        bufferRef.current = drawingRef.current ? [buffer[buffer.length - 1]] : [];
        carriedRef.current = drawingRef.current;
        socket.emit('board:draw', { color: colorRef.current, points: buffer });
        setSent((n) => n + 1);
      }, 16);
    }

    return () => {
      cancelled = true;
      if (flush !== null) clearInterval(flush);
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [auth.tokens]);

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * BOARD_W),
      y: Math.round(((e.clientY - rect.top) / rect.height) * BOARD_H),
    };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    const p = pointFromEvent(e);
    bufferRef.current.push(p);
    drawStroke({ color: colorRef.current, points: [p] });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const p = pointFromEvent(e);
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last) drawStroke({ color: colorRef.current, points: [last, p] });
    bufferRef.current.push(p);
  }

  function onUp() {
    drawingRef.current = false;
    // Якщо в буфері лише точка, перенесена з попередньої пачки, її вже надіслано.
    if (carriedRef.current && bufferRef.current.length === 1) bufferRef.current = [];
    carriedRef.current = false;
  }

  function clearBoard() {
    socketRef.current?.emit('board:clear');
    clearCanvas();
  }

  return (
    <>
      <PageTitle title="Живе: presence і дошка" sub="socket.io: хто онлайн і спільна дошка, Redis-адаптер для двох API. Порівняння polling / SSE / WebSocket на сторінці Черга і воркер" />

      <Topic
        what={
          <>
            Presence відповідає на питання «хто зараз на сайті». Сервер штовхає клієнтам оновлення сам, коли хтось зайшов або вийшов, а клієнти не опитують його
            раз на секунду.
          </>
        }
        when={
          <>
            Потрібно для чатів, спільного редагування, лобі гри: там, де важливо бачити живих людей. Не потрібно для «востаннє бачили» або статистики відвідувань:
            досить записати час у базу.
          </>
        }
        how={
          <>
            Клієнт підключається до namespace /live з JWT у handshake. Для кожного користувача в Redis лежить ключ із TTL 30 с і лічильник вкладок, heartbeat
            оновлює їх кожні 10 с. TTL потрібен на випадок, коли процес API впав: подія disconnect тоді не прийде, і без TTL людина висіла б онлайн вічно.
            Офлайн користувач стає, коли закрилась остання його вкладка.
          </>
        }
      />

      <Card title="Хто онлайн (presence:update)">
        <div className="prose">
          <p>
            Ти підключаєшся автоматично, тому в списку принаймні ти сам. Статус вище і журнал нижче показують сирі події сокета: connect, presence:update,
            board:history. Поле instance каже, який саме API надіслав подію (api-1 або api-2 у docker compose, інакше один api-1).
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <span className={`status-dot ${connected ? 'ok' : 'down'}`} />
          <span data-testid="ws-status">{connected ? 'підключено' : 'не підключено'}</span>
          {online && <span className="muted small">instance: {online.instance}</span>}
        </div>
        {error && <div className="note err">{error}</div>}
        <ul data-testid="presence">
          {(online?.online ?? []).map((u) => (
            <li key={u.userId}>
              {u.displayName} <span className="muted small mono">{u.userId.slice(0, 8)}</span>
            </li>
          ))}
        </ul>
        <h3>Журнал подій</h3>
        <pre className="mono small" style={{ maxHeight: 200, overflow: 'auto' }}>
          {log.join('\n') || 'порожньо'}
        </pre>
        <PanelFooter
          paths={['src/modules/live/live.gateway.ts (handshake, heartbeat кожні 10 с)', 'src/modules/live/presence.service.ts (TTL 30 с, лічильник вкладок)']}
          tries={[
            <>
              Відкрий цю сторінку ще в одній вкладці під іншим користувачем: у списку мають бути обидва. Закрий її: другий зникне одразу.
            </>,
            <>
              Вбий процес API через kill -9 і виконай у redis-cli TTL presence:&lt;твій id&gt;: ключ зникне сам за 30 с, бо disconnect не прийшов.
            </>,
          ]}
        />
      </Card>

      <Topic
        what={
          <>
            Спільна дошка: штрих, який ти малюєш, з'являється в усіх відкритих вкладках, а нова вкладка одразу отримує вже намальоване.
          </>
        }
        when={
          <>
            Потрібно, коли дія одного клієнта має дійти до інших миттєво: дошка, чат, курсори. Не потрібно, коли досить оновити сторінку раз на хвилину: тоді
            звичайний GET простіший і дешевший.
          </>
        }
        how={
          <>
            Клієнт збирає точки в буфер і кожні 16 мс (один кадр) шле одну подію board:draw з пачкою, а не десятки на кожен рух миші. Сервер розсилає її в кімнату
            board усім, крім відправника, і додає в Redis list board:strokes (до 5000 штрихів). Новий сокет одразу отримує цей список як board:history.
          </>
        }
        extra={
          <>
            <p>
              <b>Навіщо Redis-адаптер.</b> У docker compose працюють два API: api-1 і api-2, а nginx роздає з'єднання по черзі. Твоя вкладка потрапила на api-1,
              вкладка друга на api-2. Ти малюєш, api-1 хоче розіслати штрих «усім у кімнаті», але знає лише про сокети, підключені до нього самого. Вкладка на
              api-2 для нього не існує, і штрих туди не дійде.
            </p>
            <p>
              Redis-адаптер це внутрішній телефон між API. api-1 кладе подію в Redis, api-2 її чує і розсилає своїм сокетам. Клієнтам цього не видно: вони
              бачать одну кімнату. З одним API адаптер нічого не змінює, тому на локальному запуску без Docker різниці не відчути. Те саме правило, що для presence:
              стан живе в Redis, а не в пам'яті процесу.
            </p>
          </>
        }
      />

      <Card title="Дошка (board:draw, board:history, board:clear)">
        <div className="prose">
          <p>
            Відкрий цю сторінку у двох вкладках, можна під різними користувачами: це єдина панель, якій потрібна друга вкладка. Малюй мишею в одній: штрих з'явиться
            в іншій, у кожної вкладки свій колір. Третя вкладка, відкрита пізніше, одразу покаже намальоване (history при вході).
          </p>
          <p>
            Погано, якби штрих з іншої вкладки не з'являвся: значить, сокети сидять на різних API без спільного адаптера. Сама дошка в одній вкладці теж працює, бо
            твій штрих малюється локально.
          </p>
        </div>
        <NeedAuth />
        <div className="row">
          <span className="pill">
            мій колір{' '}
            <span style={{ display: 'inline-block', width: 14, height: 14, background: colorRef.current, borderRadius: 3, verticalAlign: 'middle' }} />
          </span>
          <span className="pill">
            надіслано пачок{' '}
            <b className="mono" data-testid="sent">
              {sent}
            </b>
          </span>
          <span className="pill">
            отримано board:draw{' '}
            <b className="mono" data-testid="received">
              {received}
            </b>
          </span>
          {historyCount !== null && (
            <span className="pill">
              history при вході <b className="mono">{historyCount}</b>
            </span>
          )}
          <button type="button" className="danger" onClick={clearBoard} disabled={!connected} data-testid="clear">
            board:clear (для всіх)
          </button>
        </div>
        <canvas
          ref={canvasRef}
          className="board"
          width={BOARD_W}
          height={BOARD_H}
          data-testid="board"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        <PanelFooter
          paths={['src/modules/live/board.service.ts (Redis list board:strokes, LTRIM 5000)', 'src/modules/live/redis-io.adapter.ts (@socket.io/redis-adapter)', 'src/modules/live/live.gateway.ts (board:draw)']}
          tries={[
            <>
              Намалюй щось, відкрий третю вкладку: штрихи прийдуть як history. Подивись у redis-cli LLEN board:strokes.
            </>,
            <>
              У redis-io.adapter.ts закоментуй рядок server.adapter(...), підніми docker compose з двома API і малюй: частина вкладок перестане бачити одна одну.
            </>,
          ]}
        />
      </Card>
    </>
  );
}
