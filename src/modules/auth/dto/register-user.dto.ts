import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserType } from '../../users/user-type';

export class RegisterUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/)
  otp: string;

  @ApiProperty({ example: 'ios-installation-uuid' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;

  @ApiPropertyOptional({
    example: 'Heros@Test123',
    description:
      'Optional password. Provide it to enable POST /v1/auth/login; OTP-only accounts can omit it.',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  @ApiProperty({ example: '1995-08-20' })
  @IsDateString()
  dateOfBirth: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other', 'undisclosed'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other', 'undisclosed'])
  gender?: string;

  @ApiProperty({ example: '+84901234567' })
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone: string;

  @ApiProperty({
    enum: ['device_owner', 'emergency_contact'],
    description:
      'device_owner can create SOS; emergency_contact and community_responder can receive and accept SOS alerts.',
  })
  @IsIn(['device_owner', 'emergency_contact'])
  userType: UserType;
}
