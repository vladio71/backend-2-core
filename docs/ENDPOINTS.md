# Ендпоінти

Auth: `Bearer` означає заголовок `Authorization: Bearer <accessToken>`. `admin` означає роль admin.

## health, docs
| Метод | Шлях | Auth | Що |
|---|---|---|---|
| GET | /health | ні | статус Postgres і Redis, 503 якщо щось лежить |
| GET | /metrics | ні | метрики для Prometheus текстом (у воркері те саме на порту 9464), див. docs/observability.md |
| GET | /openapi.json | ні | OpenAPI-документ |
| GET | /reference | ні | Scalar UI |
| GET | /queues | development: ні, інакше JWT admin у `?token=` | Bull Board |
| GET | /demo/live | ні | демо-сторінка |

## auth
| Метод | Шлях | Auth | Тіло | Відповідь |
|---|---|---|---|---|
| POST | /auth/register | ні | `{ email, password(8+), displayName }` | 201 `{ user, tokens: { accessToken, refreshToken, expiresIn } }`; 409 EMAIL_TAKEN |
| POST | /auth/login | ні | `{ email, password }` | 200 те саме; 401 |
| POST | /auth/refresh | ні | `{ refreshToken }` | 200 нова пара; 401 якщо спалений, відкликаний або протермінований |
| POST | /auth/logout | ні | `{ refreshToken }` | 204 |
| GET | /auth/me | Bearer | | 200 `{ id, email, displayName, role }` |

## posts
| Метод | Шлях | Auth | Параметри | Відповідь |
|---|---|---|---|---|
| GET | /posts | ні | `q, tags=a,b, tagsMode=any\|all, authorId, status, dateFrom, dateTo, sort=createdAt\|title\|likes, dir=asc\|desc, page, pageSize, mode=offset\|cursor, cursor` | offset: `{ items, page, pageSize, total }`; cursor: `{ items, nextCursor }` |
| GET | /posts/:id | ні | | пост або 404 |
| POST | /posts | Bearer, token bucket 10/10с | `{ title, body, tags?, status?, likes?, meta?: { seo?: { title?, description? } } }` | 201; 400 на невідоме поле; 429 |
| PATCH | /posts/:id | Bearer (автор або admin) | часткове тіло | 200; 403 |
| DELETE | /posts/:id | Bearer (автор або admin) | | 204, soft delete |
| POST | /posts/:id/restore | Bearer | | 201; 409 NOT_DELETED |
| POST | /posts/:id/publish | Bearer | | 201; 409 ALREADY_PUBLISHED; транзакція posts + activity |
| GET | /posts/:id/stats | ні | | агрегат, заголовок `X-Cache: HIT\|MISS` |
| POST | /posts/:id/moderate | Bearer | | 201 `{ postId, action, reason, attempts }`; 502 LLM_BAD_OUTPUT |
| GET | /posts/similar | ні | `q` | 200 `[{ id, title, distance }]`; 422 PGVECTOR_UNAVAILABLE |

## queries / demo
| Метод | Шлях | Auth | Параметри | Відповідь |
|---|---|---|---|---|
| GET | /reports/posts-per-day | ні | `days=30` | `[{ day, authorName, posts, likes, runningTotal }]` |
| GET | /demo/n-plus-one | ні | `fixed=true\|false` | `{ fixed, postsReturned, queryCount, queries, items }` |
| GET | /demo/explain | ні | `indexed=true\|false` | `{ nodeType, indexName, rowsMatched, planningTimeMs, executionTimeMs, plan }` |
| GET | /demo/pool/stats | ні | | `{ max, total, idle, waiting }` |
| GET | /demo/pool/slow | ні | `seconds=1, n=20` | `{ poolMax, wallClockMs, timings: [{ index, waitedForConnectionMs, totalMs }], poolAfter }` |
| GET | /demo/throttled | ні | | 200; 429 після 10 за 10 с (@nestjs/throttler) |
| GET | /demo/sql-injection | ні, тільки NODE_ENV=development | `safe=true\|false, q` | `{ safe, sql, rows }` |

## credits
| Метод | Шлях | Auth | Тіло | Відповідь |
|---|---|---|---|---|
| GET | /credits/me | Bearer | | `{ userId, balance, reserved }` |
| POST | /credits/topup | admin | `{ userId, amount }` | 201 баланс |
| POST | /credits/reserve | Bearer | `{ amount }` | 201 резервація; 422 INSUFFICIENT_CREDITS |
| POST | /credits/reservations/:id/confirm | Bearer | | 201; 409 якщо не reserved; 404 чужа |
| POST | /credits/reservations/:id/release | Bearer | | 201; 409; 404 |

## github
| Метод | Шлях | Auth | Тіло | Відповідь |
|---|---|---|---|---|
| POST | /github/import | Bearer | `{ username }` | 201 `{ username, imported, client: { inFlight, queued, retries } }`; 502 GITHUB_NOT_FOUND / GITHUB_RATE_LIMITED |
| GET | /github/repos/:owner | ні | | список з таблиці |

## jobs
| Метод | Шлях | Auth | Тіло | Відповідь |
|---|---|---|---|---|
| POST | /reports | Bearer | `{ failRate?: 0..1 }` | 202 `{ id, status: "queued", statusUrl, eventsUrl }`; 429 QUEUE_FULL |
| GET | /reports/:id | Bearer (власник) | | `{ status, progress, attempts, result, error, ... }` |
| GET | /reports/:id/events | Bearer або `?token=` | | SSE `data: {...}` до completed/failed |
| GET | /reports/queue-stats | ні | | `{ waiting, active, completed, failed, maxWaiting }` |
| POST | /events | Bearer | `{ type, payload? }` | 202 `{ queued: true }` |

## live (socket.io, namespace /live, auth: { token, displayName })
| Подія | Напрямок | Дані |
|---|---|---|
| report:progress | сервер -> user:<id> | `{ reportId, status, progress, attempt, result?, error? }` |
| presence:update | сервер -> всі | `{ online: [{ userId, displayName }], instance }` |
| presence:list | клієнт -> сервер (ack) | `{ online }` |
| board:history | сервер -> новий сокет | `[{ userId, color, points }]` |
| board:draw | клієнт -> сервер -> інші | `{ color, points: [{ x, y }] }` |
| board:clear | клієнт -> сервер -> всі | |
