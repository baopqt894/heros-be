import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { CommerceOrder, CommerceOrderSchema } from './commerce.schema';
import { CommerceService } from './commerce.service';
import { CommerceController } from './commerce.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CommerceOrder.name, schema: CommerceOrderSchema },
    ]),
  ],
  controllers: [CommerceController],
  providers: [CommerceService, AuthRateLimitService],
})
export class CommerceModule {}
