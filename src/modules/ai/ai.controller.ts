// Що це: HTTP для AI-функцій: модерація поста і пошук схожих.
// Чому GET /posts/similar тут, а не в PostsController: це інший модуль, інша залежність (LLM/вектори).
// Увага: маршрут /posts/similar має бути зареєстрований РАНІШЕ за /posts/:id, інакше "similar" сприйметься як id.
// AiModule у AppModule стоїть перед PostsModule саме тому (і e2e-тест це перевіряє).
import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { PostEmbeddingsService } from './post-embeddings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('ai')
@Controller('posts')
export class AiController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly embeddings: PostEmbeddingsService,
  ) {}

  @Get('similar')
  similar(@Query('q') q?: string) {
    return this.embeddings.similar((q ?? '').slice(0, 1000));
  }

  @Post(':id/moderate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  moderate(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.moderate(id);
  }
}
