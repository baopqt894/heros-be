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
}
