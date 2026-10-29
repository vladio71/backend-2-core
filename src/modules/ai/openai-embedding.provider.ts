// Що це: адаптер ембедингів OpenAI (/embeddings). dimensions=384, щоб збігалося з колонкою vector(384).
import { EMBEDDING_DIM, EmbeddingProvider } from './embedding.provider';
import { UpstreamError } from '../errors/domain-errors';

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: text.slice(0, 8000), dimensions: EMBEDDING_DIM }),
    });
    if (!response.ok) {
      throw new UpstreamError('EMBEDDING_HTTP_ERROR', `Embeddings API відповів ${response.status}`);
    }
    const data = (await response.json()) as EmbeddingResponse;
    const vector = data.data?.[0]?.embedding;
    if (!vector || vector.length !== EMBEDDING_DIM) {
      throw new UpstreamError('EMBEDDING_BAD_OUTPUT', 'Embeddings API повернув вектор неправильної довжини');
    }
    return vector;
  }
}
