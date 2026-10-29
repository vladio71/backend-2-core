// Що це: DTO реєстрації. class-validator перевіряє поля ДО того, як запит дійде до сервісу.
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName!: string;
}
