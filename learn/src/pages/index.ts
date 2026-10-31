// Список тем: шлях, назва в меню, компонент. Порядок = порядок у лівому меню, у нумерації і в "Попередня / Наступна" внизу сторінки.
// Той самий порядок у README бекенду ("Карта модулів") і в посиланнях внизу docs/modules/*.md.
import { ComponentType } from 'react';
import { SchemePage } from './SchemePage';
import { StartPage } from './StartPage';
import { ErrorsPage } from './ErrorsPage';
import { PaginationPage } from './PaginationPage';
import { MigrationsPage } from './MigrationsPage';
import { SqlPage } from './SqlPage';
import { CachePage } from './CachePage';
import { LoggingPage } from './LoggingPage';
import { TestsPage } from './TestsPage';
import { CreditsPage } from './CreditsPage';
import { QueuePage } from './QueuePage';
import { LivePage } from './LivePage';
import { PoolPage } from './PoolPage';
import { RateLimitPage } from './RateLimitPage';
import { SecurityPage } from './SecurityPage';
import { ObservabilityPage } from './ObservabilityPage';
import { GithubPage } from './GithubPage';
import { AiPage } from './AiPage';
import { DeployPage } from './DeployPage';

export interface PageDef {
  path: string;
  title: string;
  component: ComponentType;
}

export const PAGES: PageDef[] = [
  { path: '/', title: 'Схема проєкту', component: SchemePage },
  { path: '/start', title: 'Старт', component: StartPage },
  { path: '/errors', title: 'Конфіг і формат помилок', component: ErrorsPage },
  { path: '/pagination', title: 'Пагінація, сортування, фільтри', component: PaginationPage },
  { path: '/migrations', title: 'Міграції, час, soft delete', component: MigrationsPage },
  { path: '/sql', title: 'SQL, N+1 і індекси', component: SqlPage },
  { path: '/cache', title: 'Кеш', component: CachePage },
  { path: '/logging', title: 'Логи, request-id і health', component: LoggingPage },
  { path: '/tests', title: 'Тести і CI', component: TestsPage },
  { path: '/credits', title: 'Кредити і локи', component: CreditsPage },
  { path: '/queue', title: 'Черга і воркер: polling, SSE, WebSocket', component: QueuePage },
  { path: '/live', title: 'Живе: presence і дошка', component: LivePage },
  { path: '/pool', title: "Пул з'єднань", component: PoolPage },
  { path: '/ratelimit', title: 'Rate limit', component: RateLimitPage },
  { path: '/security', title: 'Безпека', component: SecurityPage },
  { path: '/observability', title: 'Метрики, трейси, graceful shutdown', component: ObservabilityPage },
  { path: '/github', title: 'Зовнішнє API (GitHub)', component: GithubPage },
  { path: '/ai', title: 'AI: LLM і вектори', component: AiPage },
  { path: '/deploy', title: 'Деплой', component: DeployPage },
];
