import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_TYPES, UserType } from '../../users/user-type';

export class RequestEmailOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ default: 'login', enum: ['login', 'register'] })
  @IsOptional()
  @IsIn(['login', 'register'])
  purpose: 'login' | 'register' = 'login';
}

export class VerifyEmailOtpDto extends RequestEmailOtpDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/)
  otp: string;

  @ApiProperty({ example: 'ios-installation-uuid' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token received by the Swift app' })
  @IsString()
  @MinLength(100)
  idToken: string;

  @ApiProperty({ example: 'ios-installation-uuid' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;

  @ApiPropertyOptional({
    enum: USER_TYPES,
    description: 'Required only when Google Sign-In creates a new account.',
  })
  @IsOptional()
  @IsIn(USER_TYPES)
  userType?: UserType;
}

export class PasswordLoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Heros@Test123', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: 'ios-installation-uuid' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/)
  otp: string;

  @ApiProperty({ example: 'Heros@Test123', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;

  @ApiProperty({ example: 'ios-installation-uuid' })
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;

  @ApiPropertyOptional({ example: 'ios-installation-uuid' })
  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class LogoutDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}
