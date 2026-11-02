import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateHardwareDeviceDto {
  @ApiProperty({ description: 'Activation code from the purchase email or QR. Not the device token.' })
  @IsString()
  @MinLength(20)
  @MaxLength(80)
  activationCode: string;
}
