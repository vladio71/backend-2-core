// Що це: доступ до таблиці users. Тонка обгортка над TypeORM-репозиторієм.
// Чому: інші модулі не ходять у Repository<User> напряму, а через ці три методи.
// Хто викликає: AuthService, seed.
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './user.entity';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  role?: UserRole;
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(input: CreateUserInput): Promise<User> {
    const user = this.repo.create({ ...input, role: input.role ?? 'user' });
    return this.repo.save(user);
  }
}
