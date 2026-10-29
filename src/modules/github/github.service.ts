// Що це: імпорт репозиторіїв у таблицю github_repos. UPSERT по (owner, name).
// Хто викликає: GithubController.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GithubRepo } from './github-repo.entity';
import { GithubClient } from './github.client';

export interface ImportResult {
  username: string;
  imported: number;
  client: { inFlight: number; queued: number; retries: number };
}

@Injectable()
export class GithubService {
  constructor(
    @InjectRepository(GithubRepo) private readonly repos: Repository<GithubRepo>,
    private readonly client: GithubClient,
  ) {}

  async importUser(username: string, importedBy: string): Promise<ImportResult> {
    const remote = await this.client.listUserRepos(username);
    if (remote.length > 0) {
      await this.repos.upsert(
        remote.map((r) => ({
          githubId: String(r.id),
          owner: r.owner.login,
          name: r.name,
          description: r.description,
          stars: r.stargazers_count,
          language: r.language,
          importedBy,
        })),
        { conflictPaths: ['owner', 'name'] },
      );
    }
    return { username, imported: remote.length, client: this.client.stats() };
  }

  listByOwner(owner: string): Promise<GithubRepo[]> {
    return this.repos.find({ where: { owner }, order: { stars: 'DESC' } });
  }
}
