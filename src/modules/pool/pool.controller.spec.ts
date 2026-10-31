import { SLOW_MAX_N, SLOW_MAX_SECONDS, clampSlowParams } from './pool.controller';

describe('clampSlowParams', () => {
  it('обмежує n до 30 і seconds до 5 зверху, до 1 знизу', () => {
    expect(SLOW_MAX_N).toBe(30);
    expect(SLOW_MAX_SECONDS).toBe(5);
    expect(clampSlowParams(10, 50)).toEqual({ seconds: 5, n: 30 });
    expect(clampSlowParams(0, -3)).toEqual({ seconds: 1, n: 1 });
    expect(clampSlowParams(2, 20)).toEqual({ seconds: 2, n: 20 });
  });
});
