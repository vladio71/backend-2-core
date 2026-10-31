// Що це: модуль AI. Обирає провайдерів за env: є OPENAI_API_KEY -> OpenAI, нема -> фейки.
// @Global, щоб PostsService міг інжектити POST_INDEXER без імпорту AiModule (ai імпортує Post, зустрічний імпорт дав би цикл).
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../posts/post.entity';
import { POST_INDEXER } from '../posts/post-indexer';
import { APP_CONFIG } from '../config/config.module';
import { AppConfig } from '../config/config.schema';
import { LLM_PROVIDER, LlmProvider } from './llm.provider';
import { FakeLlmProvider } from './fake-llm.provider';
import { OpenAiLlmProvider } from './openai-llm.provider';
import { EMBEDDING_PROVIDER, EmbeddingProvider, FakeEmbeddingProvider } from './embedding.provider';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider';
import { ModerationService } from './moderation.service';
import { PostEmbeddingsService } from './post-embeddings.service';
import { AiController } from './ai.controller';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Post]), AuthModule],
  controllers: [AiController],
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): LlmProvider =>
        config.OPENAI_API_KEY && config.NODE_ENV !== 'test'
          ? new OpenAiLlmProvider(config.OPENAI_API_KEY, config.OPENAI_BASE_URL, config.OPENAI_MODEL)
          : new FakeLlmProvider(),
    },
    {
      provide: EMBEDDING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): EmbeddingProvider =>
        config.OPENAI_API_KEY && config.NODE_ENV !== 'test'
          ? new OpenAiEmbeddingProvider(config.OPENAI_API_KEY, config.OPENAI_BASE_URL, config.OPENAI_EMBEDDING_MODEL)
          : new FakeEmbeddingProvider(),
    },
    ModerationService,
    PostEmbeddingsService,
    // Реалізація інтерфейсу PostIndexer з модуля posts: той самий екземпляр PostEmbeddingsService під іншим токеном.
    { provide: POST_INDEXER, useExisting: PostEmbeddingsService },
  ],
  exports: [PostEmbeddingsService, POST_INDEXER],
})
export class AiModule {}
