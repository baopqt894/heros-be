import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { SosService } from '../sos/sos.service';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly sos: SosService
  ) {}

  @Public()
  @Get('storage')
  async storage(@Headers('x-heros-ops-token') token?: string) {
    const secret = this.config.get<string>('OPS_HEALTH_TOKEN');
    const actual = Buffer.from(token || '');
    const expected = Buffer.from(secret || '');
    if (
      !secret ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new UnauthorizedException();
    return { success: true, data: await this.sos.storageHealth() };
  }

  @Public()
  @Get()
  getHealth() {
    return {
      success: true,
      data: {
        status: this.connection.readyState === 1 ? 'ok' : 'degraded',
        database:
          this.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
