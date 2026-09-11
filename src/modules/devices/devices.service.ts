import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { Device, DeviceDocument } from './schemas/device.schema';

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>
  ) {}

  register(userId: string, dto: RegisterDeviceDto) {
    return this.deviceModel.findOneAndUpdate(
      { userId, deviceId: dto.deviceId },
      {
        $set: {
          platform: dto.platform,
          pushToken: dto.pushToken,
          enabled: true,
          lastSeenAt: new Date(),
        },
        $setOnInsert: {
          userId: new Types.ObjectId(userId),
          deviceId: dto.deviceId,
        },
      },
      { new: true, upsert: true, runValidators: true }
    );
  }

  disable(userId: string, deviceId: string) {
    return this.deviceModel.updateOne(
      { userId, deviceId },
      { $set: { enabled: false, lastSeenAt: new Date() } }
    );
  }

  async findPushTokens(userIds: string[]): Promise<string[]> {
    return this.deviceModel
      .find({ userId: { $in: userIds }, enabled: true })
      .distinct('pushToken') as Promise<string[]>;
  }
}
