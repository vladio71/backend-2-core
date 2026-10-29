// Що це: HTTP-клієнт до GitHub REST API, який поважає документовані ліміти.
// Ліміти (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
//   primary: 5000 запитів/год з токеном, 60/год без токена;
//   secondary: не більше 100 одночасних запитів, не більше 900 поінтів/хв для REST (GET = 1 поінт).
// На 429 або 403 з Retry-After чекаємо вказану кількість секунд і повторюємо, максимум 3 рази.
// Хто викликає: GithubService.
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { Semaphore, WindowBudget, defaultSleep } from './semaphore';
import { UpstreamError } from '../errors/domain-errors';
import { AppLogger } from '../logging/app-logger';

export interface GithubRepoDto {
  id: number;
  name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  owner: { login: string };
}

export interface GithubClientStats {
  inFlight: number;
  queued: number;
  retries: number;
}

const MAX_CONCURRENT = 100;
const POINTS_PER_MINUTE = 900;
const MAX_RETRIES = 3;

@Injectable()
export class GithubClient {
  private readonly logger = new AppLogger('GithubClient');
  private readonly semaphore = new Semaphore(MAX_CONCURRENT);
  private readonly minuteBudget = new WindowBudget(POINTS_PER_MINUTE, 60_000);
  private readonly hourBudget: WindowBudget;
  private retries = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.hourBudget = new WindowBudget(config.GITHUB_TOKEN ? 5000 : 60, 3_600_000);
  }

  stats(): GithubClientStats {
    return { inFlight: this.semaphore.inFlight, queued: this.semaphore.queued, retries: this.retries };
  }

  // Усі публічні репозиторії користувача, посторінково (per_page=100).
  async listUserRepos(username: string): Promise<GithubRepoDto[]> {
    const all: GithubRepoDto[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.get<GithubRepoDto[]>(`/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  private async get<T>(path: string): Promise<T> {
    await this.hourBudget.take(1);
    await this.minuteBudget.take(1);
    await this.semaphore.acquire();
    try {
      return await this.getWithRetry<T>(path, 0);
    } finally {
      this.semaphore.release();
    }
  }

  private async getWithRetry<T>(path: string, attempt: number): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devhub-core-teaching-project',
    };
    if (this.config.GITHUB_TOKEN) headers.Authorization = `Bearer ${this.config.GITHUB_TOKEN}`;

    const response = await fetch(`${this.config.GITHUB_API_URL}${path}`, { headers });

    if (response.status === 429 || (response.status === 403 && response.headers.get('retry-after'))) {
      if (attempt >= MAX_RETRIES) {
        throw new UpstreamError('GITHUB_RATE_LIMITED', 'GitHub обмежив запити, спроби вичерпано', { path });
      }
      const retryAfter = Number(response.headers.get('retry-after') ?? '1');
      this.retries += 1;
      this.logger.warn(`GitHub ${response.status}, чекаю ${retryAfter}s (спроба ${attempt + 1}/${MAX_RETRIES})`);
      await defaultSleep(retryAfter * 1000);
      return this.getWithRetry<T>(path, attempt + 1);
    }
    if (response.status === 404) {
      throw new UpstreamError('GITHUB_NOT_FOUND', 'GitHub: користувача не знайдено', { path });
    }
    if (!response.ok) {
      throw new UpstreamError('GITHUB_ERROR', `GitHub відповів ${response.status}`, { path, body: await response.text() });
    }
    return (await response.json()) as T;
  }
}
