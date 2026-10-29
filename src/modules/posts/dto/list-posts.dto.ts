// Що це: query-параметри GET /posts: фільтри, сортування, дві пагінації.
// Чому: і offset (page/pageSize + total), і cursor в одному ендпоінті, щоб порівняти на одних даних.
// Якщо передано cursor або `mode=cursor`, працює cursor-пагінація, інакше offset.
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export type PostSortField = 'createdAt' | 'title' | 'likes';
export type SortDirection = 'asc' | 'desc';

export class ListPostsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  // tags=a,b,c
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((t: string) => t.trim()).filter(Boolean) : value))
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(['any', 'all'])
  tagsMode: 'any' | 'all' = 'any';

  @IsOptional()
  @IsUUID()
  authorId?: string;

  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsIn(['createdAt', 'title', 'likes'])
  sort: PostSortField = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir: SortDirection = 'desc';

  @IsOptional()
  @IsIn(['offset', 'cursor'])
  mode: 'offset' | 'cursor' = 'offset';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;

  @IsOptional()
  @IsString()
  cursor?: string;
}
