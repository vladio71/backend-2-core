// Що це: повний список сутностей TypeORM. Єдине місце, де вони перелічені.
// Чому тут, а не у modules/database: database це нижній шар і не має знати, які теми є у застосунку.
// Список передає корінь (app.module.ts, worker.module.ts, data-source.ts), який і так знає про всі модулі.
// Хто викликає: DatabaseModule.forRoot(entities), buildDataSourceOptions(config, entities) у CLI, тестах і скриптах.
import { EntityList } from './modules/database/data-source-options';
import { User } from './modules/users/user.entity';
import { RefreshToken } from './modules/auth/refresh-token.entity';
import { Post } from './modules/posts/post.entity';
import { Activity } from './modules/posts/activity.entity';
import { Event } from './modules/queries/event.entity';
import { CreditBalance } from './modules/credits/credit-balance.entity';
import { CreditReservation } from './modules/credits/credit-reservation.entity';
import { GithubRepo } from './modules/github/github-repo.entity';
import { Report } from './modules/jobs/report.entity';

export const entities: EntityList = [User, RefreshToken, Post, Activity, Event, CreditBalance, CreditReservation, GithubRepo, Report];
