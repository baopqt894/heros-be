import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { WebRegisterDto } from './dto/web-register.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
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
  @Post('web/register')
  async registerWeb(@Body() dto: WebRegisterDto, @Req() request: Request) {
    this.rateLimit.consume(`web-register:ip:${request.ip}`, 10, 15 * 60_000);
    return { success: true, data: await this.authService.registerWeb(dto) };
  }

  @HttpCode(200)
  @Post('logout-current')
  async logoutCurrent(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.authService.logoutCurrent(user.sub, user.sessionKey),
    };
  }

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
        dto.deviceId,
        dto.clientType
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
        dto.deviceId,
        dto.clientType
      ),
    };
  }

  @Public()
  @Post('google')
  async google(@Body() dto: GoogleLoginDto, @Req() request: Request) {
    this.rateLimit.consume(`google:ip:${request.ip}`, 30, 15 * 60_000);
    return {
      success: true,
      data: await this.authService.googleLogin(
        dto.idToken,
        dto.deviceId,
        dto.userType
      ),
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
