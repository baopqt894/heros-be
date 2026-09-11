import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { Device, DeviceSchema } from './schemas/device.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Device.name, schema: DeviceSchema }]),
  ],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
