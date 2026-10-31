// Що це: те, що posts хоче від AI, описане з боку posts: "після запису поста проіндексуй його".
// Чому тут, а не в ai: posts не імпортує ai. ai вже імпортує Post (модерація), і зустрічний імпорт дав би цикл
// між модулями. Тому posts описує інтерфейс і токен, а AiModule підставляє реалізацію (PostEmbeddingsService).
// Хто викликає: PostsService інжектить @Inject(POST_INDEXER); AiModule реєструє провайдер.
export const POST_INDEXER = Symbol('POST_INDEXER');

export interface PostIndexer {
  indexPost(postId: string, title: string, body: string): Promise<void>;
}
