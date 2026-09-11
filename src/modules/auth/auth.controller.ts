import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import {
  GoogleLoginDto,
  LogoutDto,
  PasswordLoginDto,
  RefreshTokenDto,
  RequestEmailOtpDto,
  ResetPasswordDto,
  VerifyEmailOtpDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimit: AuthRateLimitService
  ) {}

  @Public()
  @Post('email/request-otp')
  async requestOtp(@Body() dto: RequestEmailOtpDto, @Req() _request: Request) {
    this.rateLimit.consume(`otp:ip:${_request.ip}`, 10, 15 * 60_000);
    return {
      success: true,
      data: await this.authService.requestEmailOtp(dto.email, dto.purpose),
    };
  }

  @Public()
  @Post('email/verify-otp')
  async verifyOtp(@Body() dto: VerifyEmailOtpDto, @Req() request: Request) {
    this.rateLimit.consume(`verify:ip:${request.ip}`, 30, 15 * 60_000);
    return {
      success: true,
      data: await this.authService.verifyEmailOtp(
        dto.email,
        dto.otp,
        dto.deviceId
      ),
    };
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: PasswordLoginDto, @Req() request: Request) {
    this.rateLimit.consume(`password-login:ip:${request.ip}`, 20, 15 * 60_000);
    return {
      success: true,
      data: await this.authService.passwordLogin(
        dto.email,
        dto.password,
        dto.deviceId
      ),
    };
  }

  @Public()
  @HttpCode(200)
  @Post('password/reset')
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() request: Request) {
    this.rateLimit.consume(`password-reset:ip:${request.ip}`, 10, 15 * 60_000);
    return {
      success: true,
      data: await this.authService.resetPassword(
        dto.email,
        dto.otp,
        dto.newPassword,
        dto.deviceId
      ),
    };
  }

  @Public()
  @Post('google')
  async google(@Body() dto: GoogleLoginDto, @Req() request: Request) {
    this.rateLimit.consume(`google:ip:${request.ip}`, 30, 15 * 60_000);
    return {
      success: true,
      data: await this.authService.googleLogin(dto.idToken, dto.deviceId),
    };
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return {
      success: true,
      data: await this.authService.refresh(dto.refreshToken, dto.deviceId),
    };
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Body() dto: LogoutDto) {
    return {
      success: true,
      data: await this.authService.logout(dto.refreshToken),
    };
  }
}
