import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { Device, DeviceDocument } from './schemas/device.schema';
import { diagnosticFingerprint } from '../../common/utils/diagnostic-fingerprint';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);
  constructor(
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>
  ) {}

  async register(userId: string, dto: RegisterDeviceDto, sessionKey: string) {
    const context = `userId=${userId} installationFingerprint=${diagnosticFingerprint(dto.deviceId)} tokenFingerprint=${diagnosticFingerprint(dto.pushToken)} platform=${dto.platform}`;
    try {
      // Diagnostic snapshot only; the upsert below remains the authoritative write.
      const previous = await this.deviceModel
        .findOne({ userId, deviceId: dto.deviceId })
        .select('pushToken sessionKey enabled')
        .lean();
      const device = await this.deviceModel.findOneAndUpdate(
        { userId, deviceId: dto.deviceId },
        {
          $set: {
            platform: dto.platform,
            sessionKey,
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
      const tokenState = !previous
        ? 'new'
        : previous.pushToken === dto.pushToken
          ? 'unchanged'
          : 'changed';
      this.logger.log(
        `PUSH_TOKEN_REGISTERED ${context} tokenState=${tokenState} sessionUpdated=${previous?.sessionKey !== sessionKey} enabled=${device.enabled}`
      );
      return device;
    } catch (error) {
      this.logger.warn(
        `PUSH_TOKEN_REGISTER_FAILED ${context} reason=DATABASE_OPERATION_FAILED`
      );
      throw error;
    }
  }

  disable(userId: string, deviceId: string) {
    return this.deviceModel.updateOne(
      { userId, deviceId },
      { $set: { enabled: false, lastSeenAt: new Date() } }
    );
  }

  async findPushTokens(userIds: string[]): Promise<string[]> {
    const devices = await this.deviceModel.aggregate([
      {
        $match: {
          userId: { $in: userIds.map((id) => new Types.ObjectId(id)) },
          enabled: true,
          sessionKey: { $type: 'string' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'owner',
        },
      },
      { $unwind: '$owner' },
      {
        $match: {
          'owner.status': 'active',
          $expr: { $eq: ['$sessionKey', '$owner.activeSessionKey'] },
        },
      },
      { $project: { pushToken: 1 } },
    ]);
    return [...new Set<string>(devices.map((device) => device.pushToken))];
  }
}
