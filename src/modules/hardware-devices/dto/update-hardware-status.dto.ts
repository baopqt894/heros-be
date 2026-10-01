import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateHardwareStatusDto {
  @ApiProperty({ example: 82, maximum: 100, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPercent: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  isCharging: boolean;

  @ApiPropertyOptional({
    example: 2880,
    description: 'Estimate calculated by the device firmware, in minutes.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMinutesRemaining?: number;
}
