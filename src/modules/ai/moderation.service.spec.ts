import { ModerationService } from './moderation.service';
import { FakeLlmProvider } from './fake-llm.provider';
import { Repository } from 'typeorm';
import { Post } from '../posts/post.entity';
import { FakeEmbeddingProvider, EMBEDDING_DIM } from './embedding.provider';

function repoWith(post: Partial<Post>): Repository<Post> {
  return { findOne: jest.fn().mockResolvedValue(post), update: jest.fn() } as unknown as Repository<Post>;
}

describe('ModerationService (unit, FakeLlmProvider)', () => {
  it('схвалює технічний пост і зберігає рішення', async () => {
    const repo = repoWith({ id: 'p1', title: 'Як я налаштував пул з\'єднань', body: 'Довгий текст про pg pool і таймаути.' });
    const svc = new ModerationService(new FakeLlmProvider(), repo);
    const result = await svc.moderate('p1');
    expect(result.action).toBe('approve');
    expect(repo.update).toHaveBeenCalledWith({ id: 'p1' }, { moderationAction: 'approve', moderationReason: result.reason });
  });

  it('відхиляє спам', async () => {
    const svc = new ModerationService(new FakeLlmProvider(), repoWith({ id: 'p2', title: 'Buy now', body: 'crypto pump casino' }));
    const result = await svc.moderate('p2');
    expect(result.action).toBe('reject');
  });

  it('повторює один раз, якщо перша відповідь не пройшла zod', async () => {
    const svc = new ModerationService(new FakeLlmProvider(), repoWith({ id: 'p3', title: 'ok', body: 'Довгий технічний текст [[garbage-once]] про міграції.' }));
    const result = await svc.moderate('p3');
    expect(result.attempts).toBe(2);
    expect(result.action).toBe('approve');
  });

  it('після двох невалідних відповідей кидає 502 LLM_BAD_OUTPUT', async () => {
    const svc = new ModerationService(new FakeLlmProvider(), repoWith({ id: 'p4', title: 'x', body: '[[garbage]] text' }));
    await expect(svc.moderate('p4')).rejects.toMatchObject({ code: 'LLM_BAD_OUTPUT' });
  });
});

describe('FakeEmbeddingProvider', () => {
  it('детермінований, нормалізований, 384 виміри', async () => {
    const p = new FakeEmbeddingProvider();
    const a = await p.embed('postgres connection pool');
    const b = await p.embed('postgres connection pool');
    expect(a).toEqual(b);
    expect(a).toHaveLength(EMBEDDING_DIM);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});
