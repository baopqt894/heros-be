import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1, minimum: 1 })
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  limit?: number = 10;
}

export class PaginationResponseDto<T> {
  @ApiPropertyOptional({ description: 'Data items' })
  data: T[];

  @ApiPropertyOptional({ description: 'Current page number' })
  page: number;

  @ApiPropertyOptional({ description: 'Number of items per page' })
  limit: number;

  @ApiPropertyOptional({ description: 'Total number of items' })
  total: number;

  @ApiPropertyOptional({ description: 'Total number of pages' })
  totalPages: number;

  constructor(data: T[], page: number, limit: number, total: number) {
    this.data = data;
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = Math.ceil(total / limit);
  }
}
