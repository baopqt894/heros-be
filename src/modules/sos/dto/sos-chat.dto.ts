import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SendSosChatMessageDto {
  @ApiProperty({
    description: 'Stable UUID reused only when retrying the same message.',
  })
  @IsUUID()
  clientMessageId: string;

  @ApiProperty({ maxLength: 2000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text: string;
}

export class ListSosChatMessagesDto {
  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @ApiPropertyOptional({
    description: 'Load older messages; exclusive sequence cursor.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  beforeSequence?: number;

  @ApiPropertyOptional({
    description:
      'Reconnect catch-up; exclusive sequence cursor, starting at 0.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  afterSequence?: number;
}

export class ListSosChatsDto {
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  before?: string;

  @ApiPropertyOptional({ default: 'active', enum: ['active', 'closed'] })
  @IsIn(['active', 'closed'])
  status: 'active' | 'closed' = 'active';
}
