import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AppleAuthService } from './apple-auth.service';
import { AppleLoginDto } from './dto/apple.dto';

@ApiTags('auth')
@Controller('auth/apple')
export class AppleAuthController {
  constructor(
    private readonly apple: AppleAuthService,
    private readonly limits: AuthRateLimitService
  ) {}

  @Public()
  @Post()
  async login(@Body() dto: AppleLoginDto, @Req() request: Request) {
    this.limits.consume(`apple:${request.ip}`, 20, 15 * 60_000);
    return { success: true, data: await this.apple.login(dto) };
  }

  @Post('link')
  async link(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AppleLoginDto
  ) {
    this.limits.consume(`apple-link:${user.sub}`, 10, 15 * 60_000);
    return { success: true, data: await this.apple.link(user.sub, dto) };
  }
}
