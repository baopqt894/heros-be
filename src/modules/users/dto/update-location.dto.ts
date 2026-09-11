import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsNumber,
  Min,
} from 'class-validator';

export class UpdateLocationDto {
  @ApiProperty({ example: 10.762622 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: 106.660172 })
  @IsLongitude()
  longitude: number;

  @ApiProperty({ example: 12 })
  @IsNumber()
  @Min(0)
  accuracy: number;

  @ApiProperty({ example: '2026-09-10T14:30:00.000Z' })
  @IsDateString()
  recordedAt: string;
}
