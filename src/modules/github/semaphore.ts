// Що це: семафор на N одночасних операцій + лічильник бюджету "X за вікно".
// Чому: GitHub дозволяє максимум 100 одночасних запитів і 900 "поінтів" за хвилину для REST.
// Без цього Promise.all на 500 репозиторіях відправить 500 запитів разом і отримає 403 secondary limit.
// Хто викликає: GithubClient.
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }
}

// Бюджет: не більше `limit` одиниць за `windowMs`. Якщо вичерпано, чекаємо до кінця вікна.
export class WindowBudget {
  private windowStart = 0;
  private used = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async take(cost: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<void> {
    for (;;) {
      const t = now();
      if (t - this.windowStart >= this.windowMs) {
        this.windowStart = t;
        this.used = 0;
      }
      if (this.used + cost <= this.limit) {
        this.used += cost;
        return;
      }
      await sleep(this.windowStart + this.windowMs - t);
    }
  }
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
