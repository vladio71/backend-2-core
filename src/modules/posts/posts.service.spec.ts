import { PostsService, decodeCursor, encodeCursor } from './posts.service';
import { Repository, DataSource } from 'typeorm';
import { Post } from './post.entity';
import { PostStatsCache } from '../queries/post-stats-cache.service';
import { AccessTokenPayload } from '../auth/jwt.service';
import { PostEmbeddingsService } from '../ai/post-embeddings.service';

// Unit-тест: репозиторій і кеш замінені фейками. Перевіряємо правила, а не SQL.
describe('PostsService (unit)', () => {
  const owner: AccessTokenPayload = { sub: 'u1', role: 'user', email: 'a@b.c' };
  const stranger: AccessTokenPayload = { sub: 'u2', role: 'user', email: 'x@b.c' };
  const admin: AccessTokenPayload = { sub: 'u3', role: 'admin', email: 'adm@b.c' };

  function build(post: Partial<Post>) {
    const repo = {
      findOne: jest.fn().mockResolvedValue(post),
      save: jest.fn(async (p: Post) => p),
      softDelete: jest.fn(),
    } as unknown as Repository<Post>;
    const cache = { invalidate: jest.fn() } as unknown as PostStatsCache;
    const ds = {} as DataSource;
    const embeddings = { indexPost: jest.fn() } as unknown as PostEmbeddingsService;
    return { svc: new PostsService(repo, ds, cache, embeddings), repo, cache };
  }

  it('чужий користувач не може редагувати пост, адмін може', async () => {
    const { svc } = build({ id: 'p1', authorId: 'u1', title: 'old' } as Post);
    await expect(svc.update(stranger, 'p1', { title: 'hack' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const updated = await svc.update(admin, 'p1', { title: 'fixed' });
    expect(updated.title).toBe('fixed');
  });

  it('після update інвалідує кеш статистики', async () => {
    const { svc, cache } = build({ id: 'p1', authorId: 'u1' } as Post);
    await svc.update(owner, 'p1', { title: 'new title' });
    expect(cache.invalidate).toHaveBeenCalledWith('p1');
  });

  it('повторний publish дає 409 ALREADY_PUBLISHED', async () => {
    const { svc } = build({ id: 'p1', authorId: 'u1', status: 'published' } as Post);
    await expect(svc.publish(owner, 'p1')).rejects.toMatchObject({ code: 'ALREADY_PUBLISHED' });
  });

  it('курсор кодується і декодується без втрат', () => {
    const cursor = encodeCursor({ v: '2026-01-01T00:00:00.000Z', id: 'abc' });
    expect(decodeCursor(cursor)).toEqual({ v: '2026-01-01T00:00:00.000Z', id: 'abc' });
    expect(() => decodeCursor('!!!')).toThrow();
  });
});
