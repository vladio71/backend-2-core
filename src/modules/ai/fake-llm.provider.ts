// Що це: детермінований фейк LLM. Без мережі, без ключа. Прості правила замість моделі.
// Чому: тести мають бути стабільними, а проєкт має запускатися без OPENAI_API_KEY.
// Спеціальний маркер у тексті "[[garbage]]" змушує фейк повернути сміття: так тестуємо retry і 502.
// Хто викликає: AiModule, коли OPENAI_API_KEY не заданий.
import { LlmProvider } from './llm.provider';

export class FakeLlmProvider implements LlmProvider {
  private garbageCalls = 0;

  async completeJson(_systemPrompt: string, userPrompt: string): Promise<string> {
    const text = userPrompt.toLowerCase();
    if (text.includes('[[garbage]]')) {
      this.garbageCalls += 1;
      // Перший раз сміття, другий раз теж сміття: сервіс має здатися після одного retry.
      return 'Sure! Here is my answer: approve maybe?';
    }
    if (text.includes('[[garbage-once]]') && this.garbageCalls === 0) {
      this.garbageCalls += 1;
      return '{"action": "yes"}';
    }
    const spam = ['купи', 'casino', 'crypto pump', 'spam', 'buy now'].some((w) => text.includes(w));
    if (spam) {
      return JSON.stringify({ action: 'reject', reason: 'Схоже на спам або рекламу' });
    }
    if (text.replace(/заголовок:|текст:/g, '').trim().length < 20) {
      return JSON.stringify({ action: 'reject', reason: 'Пост занадто короткий' });
    }
    return JSON.stringify({ action: 'approve', reason: 'Технічний контент без порушень' });
  }
}
