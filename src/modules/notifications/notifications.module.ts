import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { FirebaseService } from './firebase.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthModule, DevicesModule],
  providers: [FirebaseService, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
