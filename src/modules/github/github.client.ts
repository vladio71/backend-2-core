// Що це: HTTP-клієнт до GitHub REST API, який поважає документовані ліміти.
// Ліміти (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
//   primary: 5000 запитів/год з токеном, 60/год без токена;
//   secondary: не більше 100 одночасних запитів, не більше 900 поінтів/хв для REST (GET = 1 поінт).
// На 429 або 403 з Retry-After чекаємо вказану кількість секунд і повторюємо, максимум 3 рази.
// Але не довше MAX_RETRY_AFTER_SECONDS: GitHub може попросити почекати хвилини, а наш HTTP-запит стільки не живе
// (nginx і клієнт відваляться по таймауту, а семафор весь цей час буде зайнятий). Тоді віддаємо 429 з тим самим
// Retry-After, і клієнт сам вирішує, коли повторити.
// Також кожен запит до GitHub має таймаут (FETCH_TIMEOUT_MS): без нього зависла відповідь тримала б слот семафора вічно.
//
// Семафор і бюджети нижче живуть у пам'яті ОДНОГО процесу. У compose працюють два API (api-1 і api-2), тож
// реальний ліміт відносно GitHub це 2 x 100 одночасних і 2 x 900 поінтів/хв, а не 100 і 900. Для точного ліміту
// на весь стенд лічильники треба винести у спільне сховище, тобто Redis: бюджет як INCR з EXPIRE (або Lua, як у
// token-bucket.service.ts), семафор як лічильник слотів із TTL на кожен слот, щоб впалий процес їх не тримав вічно.
// Тут навмисно просто: для навчання достатньо показати сам механізм, а на практиці запас 900 -> 450 на інстанс.
// Хто викликає: GithubService.
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { Semaphore, WindowBudget, defaultSleep } from './semaphore';
import { TooManyRequestsError, UpstreamError } from '../errors/domain-errors';
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
const MAX_RETRY_AFTER_SECONDS = 30;
const FETCH_TIMEOUT_MS = 10_000;

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
    const result = await this.fetchWithTimeout<T>(path);
    if ('data' in result) return result.data;
    // Чекаємо ПОЗА таймером запиту: таймаут 10 с стосується однієї відповіді GitHub, а не паузи між спробами.
    if (attempt >= MAX_RETRIES) {
      throw new UpstreamError('GITHUB_RATE_LIMITED', 'GitHub обмежив запити, спроби вичерпано', { path });
    }
    if (result.retryAfter > MAX_RETRY_AFTER_SECONDS) {
      throw new TooManyRequestsError('GITHUB_RATE_LIMITED', `GitHub просить почекати ${result.retryAfter} с, це довше за ${MAX_RETRY_AFTER_SECONDS} с`, Math.ceil(result.retryAfter));
    }
    this.retries += 1;
    this.logger.warn(`GitHub обмежив запити, чекаю ${result.retryAfter}s (спроба ${attempt + 1}/${MAX_RETRIES})`);
    await defaultSleep(result.retryAfter * 1000);
    return this.getWithRetry<T>(path, attempt + 1);
  }

  // Один запит із таймаутом. Таймер знімається лише після прочитаного тіла, бо зависнути може і response.json().
  private async fetchWithTimeout<T>(path: string): Promise<{ data: T } | { retryAfter: number }> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devhub-core-teaching-project',
    };
    if (this.config.GITHUB_TOKEN) headers.Authorization = `Bearer ${this.config.GITHUB_TOKEN}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.GITHUB_API_URL}${path}`, { headers, signal: controller.signal });

      if (response.status === 429 || (response.status === 403 && response.headers.get('retry-after'))) {
        const parsed = Number(response.headers.get('retry-after') ?? '1');
        // Retry-After може бути HTTP-датою: тоді parsed це NaN, і ми чекаємо 1 с.
        return { retryAfter: Number.isFinite(parsed) && parsed >= 0 ? parsed : 1 };
      }
      if (response.status === 404) {
        throw new UpstreamError('GITHUB_NOT_FOUND', 'GitHub: користувача не знайдено', { path });
      }
      if (!response.ok) {
        throw new UpstreamError('GITHUB_ERROR', `GitHub відповів ${response.status}`, { path, body: await response.text() });
      }
      return { data: (await response.json()) as T };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new UpstreamError('GITHUB_TIMEOUT', `GitHub не відповів за ${FETCH_TIMEOUT_MS / 1000} с`, { path });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
