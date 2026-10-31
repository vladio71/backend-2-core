// Що це: мікро-батчер. Збирає елементи і скидає їх однією пачкою: коли назбиралось maxSize або минуло maxWaitMs.
// Чому: 500 окремих INSERT = 500 раундтрипів до Postgres. 5 INSERT по 100 рядків = 5 раундтрипів.
// Кожен add() повертає проміс, який завершується разом зі своєю пачкою: BullMQ бачить job завершеним
// тільки коли його рядок справді записано.
// Хто викликає: EventsProcessor.
export type FlushFn<T> = (items: T[]) => Promise<void>;

interface Pending<T> {
  item: T;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class BatchCollector<T> {
  private pending: Pending<T>[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();
  public flushes = 0;

  constructor(
    private readonly flushFn: FlushFn<T>,
    private readonly maxSize: number,
    private readonly maxWaitMs: number,
  ) {}

  add(item: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ item, resolve, reject });
      if (this.pending.length >= this.maxSize) {
        this.scheduleFlush(0);
      } else if (!this.timer) {
        this.scheduleFlush(this.maxWaitMs);
      }
    });
  }

  private scheduleFlush(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      // Пачки виконуються послідовно: наступна чекає попередню.
      this.flushing = this.flushing.then(() => this.flushNow());
    }, delayMs);
  }

  private async flushNow(): Promise<void> {
    const batch = this.pending.splice(0, this.maxSize);
    if (batch.length === 0) return;
    if (this.pending.length > 0) this.scheduleFlush(0);
    try {
      await this.flushFn(batch.map((p) => p.item));
      this.flushes += 1;
      batch.forEach((p) => p.resolve());
    } catch (err) {
      batch.forEach((p) => p.reject(err));
    }
  }

  // Для graceful shutdown: дочекатися всього, що вже в черзі.
  async drain(): Promise<void> {
    while (this.pending.length > 0 || this.timer) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
        this.flushing = this.flushing.then(() => this.flushNow());
      }
      await this.flushing;
    }
    // Цикл виходить, коли нема ні pending, ні таймера. Але пачка, яку flushNow вже забрав із pending,
    // могла ще виконуватись (повільний INSERT): без цього await drain() повернувся б до її завершення.
    await this.flushing;
  }
}
