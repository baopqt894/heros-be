import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'ios-installation-uuid' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';

  @ApiProperty()
  @IsString()
  @MinLength(20)
  pushToken: string;
}
