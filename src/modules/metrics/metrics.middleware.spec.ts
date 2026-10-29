import { EventEmitter } from 'node:events';
import { Request, Response } from 'express';
import { MetricsMiddleware, routeLabel } from './metrics.middleware';
import { MetricsService } from './metrics.service';

// Фейковий MetricsService: лише те, що використовує middleware. Без Postgres, Redis і реального реєстру.
function fakeMetrics(): { service: MetricsService; observed: unknown[][]; inFlight: number } {
  const state = { observed: [] as unknown[][], inFlight: 0, service: undefined as unknown as MetricsService };
  state.service = {
    httpRequestsInFlight: { inc: () => state.inFlight++, dec: () => state.inFlight-- },
    observeHttp: (...args: unknown[]) => state.observed.push(args),
  } as unknown as MetricsService;
  return state;
}

function fakeRes(status: number): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  res.statusCode = status;
  return res;
}

describe('routeLabel', () => {
  it('бере шаблон маршруту, а не сирий URL', () => {
    const req = { route: { path: '/posts/:id' }, baseUrl: '', originalUrl: '/posts/7f3a' } as unknown as Request;
    expect(routeLabel(req)).toBe('/posts/:id');
  });

  it('404 без маршруту йде в unmatched', () => {
    expect(routeLabel({ baseUrl: '', originalUrl: '/nope' } as unknown as Request)).toBe('unmatched');
  });
});

describe('MetricsMiddleware', () => {
  it('рахує запит після finish: метод, маршрут, статус, тривалість', () => {
    const m = fakeMetrics();
    const mw = new MetricsMiddleware(m.service);
    const req = { method: 'GET', originalUrl: '/posts?page=2', route: { path: '/posts' }, baseUrl: '' } as unknown as Request;
    const res = fakeRes(200);
    mw.use(req, res, () => undefined);
    expect(m.inFlight).toBe(1);
    res.emit('finish');
    res.emit('close'); // другий сигнал не має рахувати запит двічі
    expect(m.inFlight).toBe(0);
    expect(m.observed).toHaveLength(1);
    const [method, route, status, seconds] = m.observed[0] as [string, string, number, number];
    expect([method, route, status]).toEqual(['GET', '/posts', 200]);
    expect(seconds).toBeGreaterThanOrEqual(0);
  });

  it('/metrics і /health не рахує', () => {
    const m = fakeMetrics();
    const mw = new MetricsMiddleware(m.service);
    for (const path of ['/metrics', '/health']) {
      const res = fakeRes(200);
      mw.use({ method: 'GET', originalUrl: path, route: { path } } as unknown as Request, res, () => undefined);
      res.emit('finish');
    }
    expect(m.observed).toHaveLength(0);
    expect(m.inFlight).toBe(0);
  });
});
