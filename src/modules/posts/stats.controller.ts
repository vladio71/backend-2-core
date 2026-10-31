// Що це: GET /posts/:id/stats з кешем у Redis і заголовком X-Cache: HIT|MISS.
// Хто викликає: клієнт.
import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PostStatsCache } from './post-stats-cache.service';
import { NotFoundError } from '../errors/domain-errors';

@ApiTags('posts')
@Controller('posts')
export class StatsController {
  constructor(private readonly cache: PostStatsCache) {}

  @Get(':id/stats')
  async stats(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.cache.get(id);
    if (!result) throw new NotFoundError('Post', id);
    res.setHeader('X-Cache', result.cache);
    return result.stats;
  }
}
