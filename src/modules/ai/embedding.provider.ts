// Що це: порт провайдера ембедингів (текст -> вектор з 384 чисел).
// Хто викликає: PostEmbeddingsService; реалізації нижче у цьому ж файлі (фейк) і openai-embedding.provider.ts.
import { createHash } from 'node:crypto';

export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';
export const EMBEDDING_DIM = 384;

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

// Фейк: вектор із хешів слів. Детермінований: один текст = один вектор. Схожі тексти (спільні слова)
// мають ближчі вектори, цього досить, щоб побачити, як працює ORDER BY embedding <-> $1.
export class FakeEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(EMBEDDING_DIM).fill(0);
    const words = text.toLowerCase().match(/[a-zа-яіїєґ0-9]+/g) ?? [];
    for (const word of words) {
      const hash = createHash('sha256').update(word).digest();
      // Кожне слово "вмикає" 4 координати.
      for (let i = 0; i < 4; i++) {
        const index = hash.readUInt16BE(i * 2) % EMBEDDING_DIM;
        vector[index] += 1;
      }
    }
    // Нормалізуємо, щоб відстань залежала від напрямку, а не від довжини тексту.
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
