# live: WebSocket, presence, дошка, два інстанси

## Що це
socket.io namespace `/live`, JWT у `handshake.auth.token`. Після підключення сокет потрапляє в кімнати `user:<id>`, `presence`, `board`.

| Подія | Напрямок | Що |
|---|---|---|
| `report:progress` | сервер -> `user:<id>` | статус звіту з воркера (через Redis pub/sub) |
| `presence:update` | сервер -> `presence` | `{ online: [...], instance }` при connect/disconnect |
| `presence:list` | клієнт -> сервер (ack) | поточний список |
| `board:history` | сервер -> новий сокет | останні до 5000 штрихів з Redis list |
| `board:draw` | клієнт -> сервер -> `board` (крім відправника) | `{ color, points: [{x,y}, ...] }`, клієнт збирає точки 16 мс |
| `board:clear` | клієнт -> сервер -> `board` | очистити для всіх |

Presence у Redis: ключ `presence:<userId>` з TTL 30 с і лічильник вкладок `presence:conn:<userId>`; heartbeat кожні 10 с. Якщо процес API впав, ключі зникнуть самі.

Демо з поясненнями: learn, сторінка "Живе" (http://localhost:5173/live): логін, звіт з трьома каналами (polling, SSE, WebSocket) і лічильниками HTTP-запитів, список онлайн, дошка. Відкрий у 3 вкладках. Є ще мінімальна сторінка без тексту `GET /demo/live` (один файл `public/live.html`), вона лишилась для швидкої перевірки без learn.

### Два інстанси і Redis-адаптер
`docker compose` піднімає `api-1` і `api-2` за nginx (round robin, без sticky). Вкладка A підключилась до api-1, вкладка B до api-2. `server.to('board').emit(...)` на api-1 без адаптера дійде тільки до сокетів api-1. `@socket.io/redis-adapter` публікує emit у Redis, і api-2 повторює його своїм сокетам.

Перевірити самому: у `src/app-setup.ts` замініть `new RedisIoAdapter(app, redisUrl)` на `new RedisIoAdapter(app, redisUrl, false)`, перезберіть (`docker compose up --build`), відкрийте 3 вкладки `/demo/live`. Приблизно половина вкладок не бачитиме штрихів і presence інших. Поверніть `true`.

## Чому так
Polling: простий, але N клієнтів x кожні 500 мс = зайве навантаження і затримка до 500 мс. SSE: один HTTP-запит, сервер пише, тільки сервер -> клієнт, працює через будь-який проксі. WebSocket: двосторонній, один на все (дошка, presence, прогрес), але потрібні `Upgrade`-заголовки в nginx і адаптер для кількох інстансів. На демо-сторінці всі три на одному job-і з лічильником запитів.

## Де в коді
- `src/modules/live/live.gateway.ts`: handshake, кімнати, події.
- `src/modules/live/redis-io.adapter.ts`: адаптер.
- `src/modules/live/presence.service.ts`, `board.service.ts`.
- `src/modules/jobs/report-events.service.ts`: міст з воркера.
- `public/live.html`, `src/modules/live/demo-page.controller.ts`.
- `nginx/nginx.conf`: `location /socket.io/` з `Upgrade`.
- `test/e2e/live.e2e-spec.ts` (socket.io-client).

## Спробуй сам
1. Додай подію `board:undo`: прибрати останній штрих відправника (`LREM` або переписати список) і розіслати `board:history`.
2. Додай `typing`-індикатор: `typing:start`/`typing:stop` у кімнату `presence` з авто-stop через 3 с на сервері.

Попередня тема: [jobs](jobs.md) | Наступна тема: [pool](pool.md)
