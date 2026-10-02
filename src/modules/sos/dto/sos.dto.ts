import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SosLocationDto {
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

  @ApiPropertyOptional({
    example: '123 Nguyễn Huệ, Quận 1, Thành phố Hồ Chí Minh',
    description: 'Human-readable address resolved by the mobile app or device.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class CreateSosDto {
  @ApiProperty()
  @IsUUID()
  clientRequestId: string;

  @ApiProperty({ example: 'Tôi đang gặp nguy hiểm, hãy giúp tôi' })
  @IsString()
  @MaxLength(500)
  message: string;

  @ApiProperty({ type: SosLocationDto })
  @ValidateNested()
  @Type(() => SosLocationDto)
  location: SosLocationDto;
}

export class UpdateSosLocationDto extends SosLocationDto {}

export class UpdateSmsStatusDto {
  @ApiProperty({ enum: ['composer_opened', 'user_reported_sent'] })
  @IsIn(['composer_opened', 'user_reported_sent'])
  status: 'composer_opened' | 'user_reported_sent';
}

export class AcknowledgeSosDto {
  @ApiPropertyOptional({
    enum: ['in_person', 'remote'],
    description: 'How the emergency contact plans to help.',
  })
  @IsOptional()
  @IsIn(['in_person', 'remote'])
  supportMode?: 'in_person' | 'remote';
}

export class CancelSosDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class UploadSosRecordingDto {
  @ApiPropertyOptional({ description: 'Stable UUID for retry-safe clip uploads.' })
  @IsOptional()
  @IsUUID()
  clientRecordingId?: string;

  @ApiProperty({
    example: 8.4,
    description: 'Audio duration reported by the recording client.',
    maximum: 120,
    minimum: 0.1,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(120)
  durationSeconds: number;
}
