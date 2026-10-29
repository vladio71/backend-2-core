// Що це: модерація поста через LLM зі структурованим виходом.
// Чому zod: відповідь LLM це рядок. Ми парсимо JSON і перевіряємо схему. Якщо сміття: одна повторна спроба
// з суворішим нагадуванням, далі 502 UpstreamError. Рішення зберігаємо на пості.
// Хто викликає: AiController (POST /posts/:id/moderate).
import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../posts/post.entity';
import { LLM_PROVIDER, LlmProvider, MODERATION_SYSTEM_PROMPT, ModerationDecision, buildModerationUserPrompt, moderationDecisionSchema } from './llm.provider';
import { NotFoundError, UpstreamError } from '../errors/domain-errors';
import { AppLogger } from '../logging/app-logger';

export interface ModerationResult extends ModerationDecision {
  postId: string;
  attempts: number;
}

@Injectable()
export class ModerationService {
  private readonly logger = new AppLogger('ModerationService');

  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
  ) {}

  async moderate(postId: string): Promise<ModerationResult> {
    const post = await this.posts.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundError('Post', postId);

    const userPrompt = buildModerationUserPrompt(post.title, post.body);
    let decision: ModerationDecision | null = null;
    let attempts = 0;
    let lastRaw = '';
    while (!decision && attempts < 2) {
      attempts += 1;
      const system = attempts === 1 ? MODERATION_SYSTEM_PROMPT : `${MODERATION_SYSTEM_PROMPT}\n\nПопередня відповідь не була валідним JSON. Поверни ТІЛЬКИ JSON.`;
      lastRaw = await this.llm.completeJson(system, userPrompt);
      decision = this.parse(lastRaw);
      if (!decision) this.logger.warn(`LLM повернув невалідну відповідь (спроба ${attempts}): ${lastRaw.slice(0, 120)}`);
    }
    if (!decision) {
      throw new UpstreamError('LLM_BAD_OUTPUT', 'LLM двічі повернув невалідну відповідь', { raw: lastRaw.slice(0, 500) });
    }
    await this.posts.update({ id: postId }, { moderationAction: decision.action, moderationReason: decision.reason });
    return { postId, attempts, ...decision };
  }

  private parse(raw: string): ModerationDecision | null {
    let json: unknown;
    try {
      // Інколи модель загортає JSON у ```json ... ```. Обрізаємо.
      json = JSON.parse(raw.replace(/^```(json)?/m, '').replace(/```$/m, '').trim());
    } catch {
      return null;
    }
    const result = moderationDecisionSchema.safeParse(json);
    return result.success ? result.data : null;
  }
}
