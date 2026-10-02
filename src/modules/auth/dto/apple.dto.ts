import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AppleLoginDto {
  @IsString()
  @MinLength(100)
  @MaxLength(10000)
  identityToken: string;

  @IsString()
  @MinLength(32)
  @MaxLength(256)
  rawNonce: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  appleId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['device_owner', 'emergency_contact'])
  userType?: 'device_owner' | 'emergency_contact';
}
