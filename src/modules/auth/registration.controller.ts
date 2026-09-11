import { Body, Controller, Post, Req } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register-user.dto';

@ApiTags('users')
@Controller('users')
export class RegistrationController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimit: AuthRateLimitService
  ) {}

  @Public()
  @Post()
  @ApiOperation({
    summary:
      'Create a user with a verified registration OTP and optional password',
  })
  @ApiCreatedResponse({
    description: 'User created; returns access and refresh tokens.',
  })
  @ApiConflictResponse({ description: 'EMAIL_ALREADY_REGISTERED' })
  async create(@Body() dto: RegisterUserDto, @Req() request: Request) {
    this.rateLimit.consume(`register:ip:${request.ip}`, 10, 15 * 60_000);
    return { success: true, data: await this.authService.register(dto) };
  }
}
