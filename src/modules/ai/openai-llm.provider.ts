// Що це: адаптер до OpenAI-сумісного HTTP API (chat/completions з response_format json_object).
// Чому без SDK: один fetch, і видно, що саме летить по мережі.
// Хто викликає: AiModule, коли OPENAI_API_KEY заданий.
import { LlmProvider } from './llm.provider';
import { UpstreamError } from '../errors/domain-errors';

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAiLlmProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async completeJson(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        // JSON mode: модель зобов'язана повернути валідний JSON. Але не зобов'язана повернути НАШУ схему.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!response.ok) {
      throw new UpstreamError('LLM_HTTP_ERROR', `LLM відповів ${response.status}`, { body: await response.text() });
    }
    const data = (await response.json()) as ChatResponse;
    return data.choices?.[0]?.message?.content ?? '';
  }
}
