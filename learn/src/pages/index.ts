// Список тем: шлях, назва в меню, компонент. Порядок = порядок у лівому меню.
import { ComponentType } from 'react';
import { StartPage } from './StartPage';
import { ErrorsPage } from './ErrorsPage';
import { PaginationPage } from './PaginationPage';
import { SqlPage } from './SqlPage';
import { CachePage } from './CachePage';
import { PoolPage } from './PoolPage';
import { CreditsPage } from './CreditsPage';
import { RateLimitPage } from './RateLimitPage';
import { GithubPage } from './GithubPage';
import { AiPage } from './AiPage';
import { QueuePage } from './QueuePage';
import { LivePage } from './LivePage';
import { SecurityPage } from './SecurityPage';
import { DeployPage } from './DeployPage';

export interface PageDef {
  path: string;
  title: string;
  component: ComponentType;
}

export const PAGES: PageDef[] = [
  { path: '/', title: 'Старт', component: StartPage },
  { path: '/errors', title: 'Помилки і формат відповіді', component: ErrorsPage },
  { path: '/pagination', title: 'Пагінація, сортування, фільтри', component: PaginationPage },
  { path: '/sql', title: 'SQL і індекси', component: SqlPage },
  { path: '/cache', title: 'Кеш', component: CachePage },
  { path: '/pool', title: "Пул з'єднань", component: PoolPage },
  { path: '/credits', title: 'Кредити і локи', component: CreditsPage },
  { path: '/ratelimit', title: 'Rate limit', component: RateLimitPage },
  { path: '/github', title: 'Зовнішнє API (GitHub)', component: GithubPage },
  { path: '/ai', title: 'AI', component: AiPage },
  { path: '/queue', title: 'Черга і воркер', component: QueuePage },
  { path: '/live', title: 'Живе', component: LivePage },
  { path: '/security', title: 'Безпека', component: SecurityPage },
  { path: '/deploy', title: 'Деплой і CI', component: DeployPage },
];
