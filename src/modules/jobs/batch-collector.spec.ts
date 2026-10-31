import { BatchCollector } from './batch-collector';

describe('BatchCollector', () => {
  it('250 елементів -> 3 пачки (100, 100, 50)', async () => {
    const sizes: number[] = [];
    const collector = new BatchCollector<number>(async (items) => {
      sizes.push(items.length);
    }, 100, 20);
    await Promise.all(Array.from({ length: 250 }, (_, i) => collector.add(i)));
    expect(sizes).toEqual([100, 100, 50]);
    expect(collector.flushes).toBe(3);
  });

  it('помилка flush відхиляє всі проміси пачки', async () => {
    const collector = new BatchCollector<number>(async () => {
      throw new Error('db down');
    }, 10, 5);
    await expect(Promise.all([collector.add(1), collector.add(2)])).rejects.toThrow('db down');
  });

  it('drain() чекає пачку, яка вже виконується (pending порожній, таймера нема)', async () => {
    let written = 0;
    const collector = new BatchCollector<number>(async (items) => {
      await new Promise((r) => setTimeout(r, 80));
      written += items.length;
    }, 1, 5);
    const added = collector.add(1);
    await new Promise((r) => setTimeout(r, 30)); // таймер спрацював, flush триває
    await collector.drain();
    expect(written).toBe(1);
    await added;
  });
});
