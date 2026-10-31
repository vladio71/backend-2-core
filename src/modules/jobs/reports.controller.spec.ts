import { EventEmitter } from 'node:events';
import { ReportsController } from './reports.controller';
import { ReportEvent } from './queues';

// SSE: подія, що прилетіла між читанням звіту з БД і підпискою, не повинна губитись.
describe('ReportsController.stream', () => {
  const reportId = '0b0c8e5a-1d7f-4a53-9a55-3f6f3c2d9e11';
  const completed: ReportEvent = { reportId, userId: 'u1', status: 'completed', progress: 100, attempt: 1, at: new Date().toISOString() };

  function build(onGet: (emit: (e: ReportEvent) => void) => void) {
    let listener: ((e: ReportEvent) => void) | null = null;
    const unsubscribed = jest.fn();
    const events = {
      subscribe: (l: (e: ReportEvent) => void) => {
        listener = l;
        return () => {
          listener = null;
          unsubscribed();
        };
      },
    };
    const reports = {
      get: async () => {
        // Подія приходить, поки ми "читаємо БД". Вона віддається слухачеві, якщо підписка вже є.
        onGet((e) => listener?.(e));
        return { id: reportId, userId: 'u1', status: 'active', progress: 40, attempts: 1, result: null, error: null };
      },
    };
    const jwt = { verify: () => ({ sub: 'u1', role: 'user', email: 'a@b.c' }) };
    const controller = new ReportsController(reports as never, events as never, jwt as never);
    const written: string[] = [];
    const res = { writeHead: jest.fn(), write: (s: string) => written.push(s), end: jest.fn() };
    const req = Object.assign(new EventEmitter(), { headers: { authorization: 'Bearer x' }, query: {} });
    return { controller, res, req, written, unsubscribed };
  }

  it('completed, що прийшов під час читання БД, доходить до клієнта, і стрім закривається', async () => {
    const { controller, res, req, written, unsubscribed } = build((emit) => emit(completed));
    await controller.stream(reportId, req as never, res as never);
    expect(written.join('')).toContain('"status":"completed"');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(unsubscribed).toHaveBeenCalled();
  });

  it('без подій стрім лишається відкритим після знімка стану; закриття клієнтом знімає підписку', async () => {
    const { controller, res, req, written, unsubscribed } = build(() => undefined);
    await controller.stream(reportId, req as never, res as never);
    expect(written.join('')).toContain('"status":"active"');
    expect(res.end).not.toHaveBeenCalled();
    req.emit('close');
    expect(unsubscribed).toHaveBeenCalled();
  });
});
