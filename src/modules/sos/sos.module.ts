import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmergencyContactsModule } from '../emergency-contacts/emergency-contacts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { HardwareDevicesModule } from '../hardware-devices/hardware-devices.module';
import { DeviceSosController } from './device-sos.controller';
import { SosEvent, SosEventSchema } from './schemas/sos-event.schema';
import { SosController } from './sos.controller';
import { SosGateway } from './sos.gateway';
import { SosService } from './sos.service';
import { DeviceTelemetryController } from './device-telemetry.controller';
import { HardwareAuthGuard } from '../hardware-devices/hardware-auth.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SosEvent.name, schema: SosEventSchema },
    ]),
    UsersModule,
    EmergencyContactsModule,
    NotificationsModule,
    HardwareDevicesModule,
  ],
  controllers: [SosController, DeviceSosController, DeviceTelemetryController],
  providers: [SosService, SosGateway, HardwareAuthGuard],
  exports: [SosService],
})
export class SosModule {}
