// Що це: DTO для refresh і logout: тільки refresh-токен.
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}
