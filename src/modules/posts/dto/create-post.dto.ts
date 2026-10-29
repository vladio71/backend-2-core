// Що це: DTO створення поста. Вкладена валідація meta.seo, трансформація типів.
// Чому: @ValidateNested + @Type кажуть class-transformer створити екземпляр вкладеного класу,
// інакше вкладені декоратори не спрацюють. whitelist+forbidNonWhitelisted у main.ts відкидають невідомі поля з 400.
// Хто викликає: PostsController.
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class SeoDto {
  @IsOptional()
  @IsString()
  @MaxLength(70)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;
}

export class PostMetaDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SeoDto)
  seo?: SeoDto;
}

export class CreatePostDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';

  // "42" з JSON-рядка стає числом 42 завдяки transform: true + enableImplicitConversion у ValidationPipe.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  likes?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PostMetaDto)
  meta?: PostMetaDto;
}
