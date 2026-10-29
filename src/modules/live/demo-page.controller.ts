// Що це: віддає public/live.html на GET /demo/live. Без фреймворку, один файл.
import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { join } from 'node:path';

@ApiExcludeController()
@Controller('demo')
export class DemoPageController {
  @Get('live')
  page(@Res() res: Response): void {
    res.sendFile(join(process.cwd(), 'public', 'live.html'));
  }
}
