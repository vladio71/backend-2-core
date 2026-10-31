// Що це: віддає public/live.html на GET /demo/live. Без фреймворку, один файл.
// Перед віддачею підставляє адресу learn (LEARN_URL з оточення, типово http://localhost:5173) у meta-тег,
// щоб посилання "відкрити в learn" працювало і тоді, коли npm run up вибрав інший порт.
import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

@ApiExcludeController()
@Controller('demo')
export class DemoPageController {
  @Get('live')
  async page(@Res() res: Response): Promise<void> {
    const html = await readFile(join(process.cwd(), 'public', 'live.html'), 'utf8');
    const learnUrl = process.env.LEARN_URL ?? 'http://localhost:5173';
    const withMeta = html.replace('<head>', `<head>\n  <meta name="learn-url" content="${learnUrl}">`);
    res.type('html').send(withMeta);
  }
}
