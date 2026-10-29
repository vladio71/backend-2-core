import { Semaphore, WindowBudget } from './semaphore';

describe('Semaphore', () => {
  it('не пускає більше max одночасно', async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      await sem.acquire();
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      sem.release();
    };
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });
});

describe('WindowBudget', () => {
  it('чекає до кінця вікна, коли бюджет вичерпано', async () => {
    let now = 0;
    const slept: number[] = [];
    const budget = new WindowBudget(2, 1000);
    const sleep = async (ms: number) => {
      slept.push(ms);
      now += ms;
    };
    await budget.take(1, () => now, sleep);
    await budget.take(1, () => now, sleep);
    await budget.take(1, () => now, sleep);
    expect(slept).toEqual([1000]);
  });
});
