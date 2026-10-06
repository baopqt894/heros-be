import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { CommerceService } from './commerce.service';
import { ClaimOrderDto, CreateOrderDto } from './commerce.dto';

@ApiTags('commerce')
@Controller('commerce')
export class CommerceController {
  constructor(
    private readonly commerce: CommerceService,
    private readonly limits: AuthRateLimitService
  ) {}
  private code(value: string) {
    if (
      !/^\d{1,16}$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1
    )
      throw new BadRequestException({ code: 'ORDER_CODE_INVALID' });
    return Number(value);
  }
  @Get('orders')
  @ApiBearerAuth('bearer-token')
  @Header('Cache-Control', 'private, no-store')
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('before') before?: string
  ) {
    return {
      success: true,
      data: await this.commerce.history(
        user.sub,
        before ? this.code(before) : undefined
      ),
    };
  }
  @Post('orders')
  @ApiBearerAuth('bearer-token')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto
  ) {
    this.limits.consume(`checkout:${user.sub}`, 6, 60000);
    return { success: true, data: await this.commerce.create(user.sub, dto) };
  }
  @Get('orders/:code')
  @ApiBearerAuth('bearer-token')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string
  ) {
    return {
      success: true,
      data: await this.commerce.get(user.sub, this.code(code)),
    };
  }
  @Public()
  @Get('guest-orders/:code')
  @Header('Cache-Control', 'private, no-store')
  async guest(@Param('code') code: string, @Req() request: Request) {
    this.limits.consume(`guest-orders:${request.ip}`, 120, 60000);
    return {
      success: true,
      data: await this.commerce.get(
        null,
        this.code(code),
        request.get('X-Heros-Order-Token')
      ),
    };
  }
  @Post('orders/claim')
  @ApiBearerAuth('bearer-token')
  async claim(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClaimOrderDto
  ) {
    return {
      success: true,
      data: await this.commerce.claim(
        user.sub,
        user.email,
        dto.orderCode,
        dto.guestToken
      ),
    };
  }
  @Public()
  @Post('payos/webhook')
  async webhook(@Body() body: unknown) {
    return { success: true, data: await this.commerce.webhook(body) };
  }
}
