import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

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
