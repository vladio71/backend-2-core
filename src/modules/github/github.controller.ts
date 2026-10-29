// Що це: HTTP для імпорту з GitHub і перегляду імпортованого.
// Хто викликає: клієнт.
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { GithubService } from './github.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/roles';
import { AccessTokenPayload } from '../auth/jwt.service';

export class ImportDto {
  @IsString()
  @MaxLength(39)
  @Matches(/^[a-zA-Z0-9-]+$/)
  username!: string;
}

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Post('import')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  import(@CurrentUser() user: AccessTokenPayload, @Body() dto: ImportDto) {
    return this.github.importUser(dto.username, user.sub);
  }

  @Get('repos/:owner')
  list(@Param('owner') owner: string) {
    return this.github.listByOwner(owner);
  }
}
