import { redactUrl } from './request-id.middleware';

describe('redactUrl', () => {
  it('замінює значення token у query на [redacted], решту лишає', () => {
    expect(redactUrl('/reports/abc/events?token=eyJ.secret.sig')).toBe('/reports/abc/events?token=[redacted]');
    expect(redactUrl('/posts?page=2&token=abc&sort=likes')).toBe('/posts?page=2&token=[redacted]&sort=likes');
    expect(redactUrl('/x?access_token=a&refresh_token=b')).toBe('/x?access_token=[redacted]&refresh_token=[redacted]');
  });

  it('URL без секретів не змінює; частковий збіг імені (mytoken) не чіпає', () => {
    expect(redactUrl('/posts?page=2&q=redis')).toBe('/posts?page=2&q=redis');
    expect(redactUrl('/posts?mytoken=1')).toBe('/posts?mytoken=1');
  });
});
