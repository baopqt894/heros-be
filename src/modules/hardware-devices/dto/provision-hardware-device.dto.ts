import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionHardwareDeviceDto {
  @ApiProperty({
    example: 'HEROS-DEV-0001',
    description: 'Stable serial number printed on the physical device.',
  })
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/)
  hardwareId: string;

  @ApiPropertyOptional({ example: 'Thiết bị HEROS của Bao' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
