import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmergencyContactsModule } from '../emergency-contacts/emergency-contacts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { SosEvent, SosEventSchema } from './schemas/sos-event.schema';
import { SosController } from './sos.controller';
import { SosGateway } from './sos.gateway';
import { SosService } from './sos.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SosEvent.name, schema: SosEventSchema },
    ]),
    UsersModule,
    EmergencyContactsModule,
    NotificationsModule,
  ],
  controllers: [SosController],
  providers: [SosService, SosGateway],
})
export class SosModule {}
