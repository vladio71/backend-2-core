// Що це: HTTP-маршрути /posts. Валідація DTO, guard-и, виклик PostsService.
// Чому POST /posts під TokenBucketGuard: саме створення постів обмежуємо (10 за 10 с на користувача).
// Хто викликає: клієнт.
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post as HttpPost, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ListPostsDto } from './dto/list-posts.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/roles';
import { AccessTokenPayload } from '../auth/jwt.service';
import { TokenBucketGuard } from '../ratelimit/token-bucket.guard';

@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(@Query() query: ListPostsDto) {
    return this.posts.list(query);
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.posts.getById(id);
  }

  @HttpPost()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TokenBucketGuard)
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreatePostDto) {
    return this.posts.create(user, dto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto) {
    return this.posts.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async remove(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.posts.softDelete(user, id);
  }

  @HttpPost(':id/restore')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  restore(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.restore(user, id);
  }

  @HttpPost(':id/publish')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  publish(@CurrentUser() user: AccessTokenPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.publish(user, id);
  }
}
