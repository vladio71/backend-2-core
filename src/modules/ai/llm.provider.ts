// Що це: порт (інтерфейс) LLM-провайдера і zod-схема відповіді модерації.
// Чому порт: сервіс модерації не знає, OpenAI це чи фейк. У тестах і без ключа працює FakeLlmProvider.
// Хто викликає: ModerationService; реалізації: openai-llm.provider.ts, fake-llm.provider.ts.
import { z } from 'zod';

export const LLM_PROVIDER = 'LLM_PROVIDER';

export interface LlmProvider {
  // Повертає СИРИЙ текст відповіді. Парсинг і валідація: у сервісі, щоб провайдер лишався простим.
  completeJson(systemPrompt: string, userPrompt: string): Promise<string>;
}

export const moderationDecisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().min(1).max(500),
});

export type ModerationDecision = z.infer<typeof moderationDecisionSchema>;

export const MODERATION_SYSTEM_PROMPT = `Ти модератор технічного блогу для розробників.
Оціни пост і вирішиш: approve (публікувати) або reject (відхилити).
Відхиляй: спам, рекламу без змісту, образи, нетехнічний контент, порожні або беззмістовні пости.
Схвалюй: усе, що стосується програмування, інструментів, досвіду розробки, навіть якщо написано просто.
Відповідай ТІЛЬКИ JSON без markdown такої форми:
{"action": "approve" | "reject", "reason": "одне коротке речення українською"}`;

export function buildModerationUserPrompt(title: string, body: string): string {
  return `Заголовок: ${title}\n\nТекст:\n${body.slice(0, 4000)}`;
}
