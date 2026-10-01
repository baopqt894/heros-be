import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { HardwareDevicesController } from './hardware-devices.controller';
import { DeviceStatusController } from './device-status.controller';
import { HardwareDevicesService } from './hardware-devices.service';
import {
  HardwareDevice,
  HardwareDeviceSchema,
} from './schemas/hardware-device.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: HardwareDevice.name, schema: HardwareDeviceSchema },
    ]),
  ],
  controllers: [HardwareDevicesController, DeviceStatusController],
  providers: [HardwareDevicesService],
  exports: [HardwareDevicesService],
})
export class HardwareDevicesModule {}
