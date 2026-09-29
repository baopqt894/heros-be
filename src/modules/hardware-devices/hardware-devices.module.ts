import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { HardwareDevicesController } from './hardware-devices.controller';
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
  controllers: [HardwareDevicesController],
  providers: [HardwareDevicesService],
  exports: [HardwareDevicesService],
})
export class HardwareDevicesModule {}
