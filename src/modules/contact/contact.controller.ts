import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { CreateContactDto } from './contact.dto';
import { ContactService } from './contact.service';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(
    private readonly contacts: ContactService,
    private readonly limits: AuthRateLimitService
  ) {}
  @Public()
  @Post()
  @Header('Cache-Control', 'private, no-store')
  async create(@Body() input: CreateContactDto, @Req() request: Request) {
    // Web also limits individual visitors. This route may see a shared gateway IP.
    this.limits.consume('contact:' + request.ip, 30, 60000);
    return { success: true, data: await this.contacts.create(input) };
  }
  @Public()
  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Authorization')
  async export(
    @Headers('authorization') authorization: string | undefined,
    @Query('after') after?: string
  ) {
    // Public bypasses user JWT only; the service requires the dedicated export key.
    return {
      success: true,
      data: await this.contacts.export(authorization, after),
    };
  }
}
