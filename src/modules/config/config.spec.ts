import { loadConfig } from './config.module';

describe('loadConfig', () => {
  it('падає з українським повідомленням, якщо бракує JWT_SECRET і DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/Застосунок не може стартувати/);
    expect(() => loadConfig({})).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('перетворює рядки у числа і підставляє значення за замовчуванням', () => {
    const cfg = loadConfig({
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: '0123456789abcdef0123',
      DB_POOL_MAX: '3',
      DB_LOG_QUERIES: 'true',
    });
    expect(cfg.DB_POOL_MAX).toBe(3);
    expect(cfg.DB_LOG_QUERIES).toBe(true);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
  });
});
