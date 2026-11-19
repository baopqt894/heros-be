import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { ContactMessage, ContactMessageSchema } from './contact.schema';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContactMessage.name, schema: ContactMessageSchema },
    ]),
  ],
  controllers: [ContactController],
  providers: [ContactService, AuthRateLimitService],
})
export class ContactModule {}
