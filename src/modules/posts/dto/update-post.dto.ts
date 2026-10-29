// Що це: DTO оновлення поста: усі поля CreatePostDto, але необов'язкові.
import { PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

// PartialType робить усі поля необов'язковими, але зберігає валідатори.
export class UpdatePostDto extends PartialType(CreatePostDto) {}
