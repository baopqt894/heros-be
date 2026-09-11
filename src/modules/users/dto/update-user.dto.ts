import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ example: '1995-08-20' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other', 'undisclosed'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other', 'undisclosed'])
  gender?: string;

  @ApiPropertyOptional({ example: '+84901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  responderEnabled?: boolean;

  @ApiPropertyOptional({ default: 5000 })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(50000)
  responderRadiusMeters?: number;
}
