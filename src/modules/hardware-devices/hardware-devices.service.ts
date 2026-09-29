import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { ProvisionHardwareDeviceDto } from './dto/provision-hardware-device.dto';
import {
  HardwareDevice,
  HardwareDeviceDocument,
} from './schemas/hardware-device.schema';

@Injectable()
export class HardwareDevicesService {
  constructor(
    @InjectModel(HardwareDevice.name)
    private readonly hardwareDeviceModel: Model<HardwareDeviceDocument>,
    private readonly usersService: UsersService
  ) {}

  async provision(ownerId: string, dto: ProvisionHardwareDeviceDto) {
    const owner = await this.usersService.getMe(ownerId);
    if (owner.userType !== 'device_owner') {
      throw new ForbiddenException({ code: 'SOS_DEVICE_OWNER_REQUIRED' });
    }

    const hardwareId = this.normalizeHardwareId(dto.hardwareId);
    const existing = await this.hardwareDeviceModel
      .findOne({ hardwareId })
      .select('+secretHash');
    if (existing && existing.ownerId.toString() !== ownerId) {
      throw new ConflictException({ code: 'HARDWARE_DEVICE_ALREADY_PAIRED' });
    }

    const deviceToken = `hdv_${randomBytes(32).toString('base64url')}`;
    let device: HardwareDeviceDocument;
    try {
      device = await this.hardwareDeviceModel.findOneAndUpdate(
        { hardwareId, ownerId: new Types.ObjectId(ownerId) },
        {
          $set: {
            enabled: true,
            label: dto.label?.trim(),
            secretHash: this.hashToken(deviceToken),
          },
          $setOnInsert: {
            hardwareId,
            ownerId: new Types.ObjectId(ownerId),
          },
        },
        { new: true, runValidators: true, upsert: true }
      );
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException({ code: 'HARDWARE_DEVICE_ALREADY_PAIRED' });
      }
      throw error;
    }

    return {
      id: device._id,
      hardwareId: device.hardwareId,
      label: device.label,
      enabled: device.enabled,
      deviceToken,
      tokenWarning:
        'Store this token securely now. The API will not return it again.',
    };
  }

  list(ownerId: string) {
    return this.hardwareDeviceModel
      .find({ ownerId: new Types.ObjectId(ownerId) })
      .sort({ createdAt: -1 });
  }

  async revoke(ownerId: string, hardwareId: string) {
    const result = await this.hardwareDeviceModel.updateOne(
      {
        hardwareId: this.normalizeHardwareId(hardwareId),
        ownerId: new Types.ObjectId(ownerId),
      },
      { $set: { enabled: false } }
    );
    if (!result.matchedCount) {
      throw new NotFoundException('Hardware device not found');
    }
    return { revoked: true };
  }

  async authenticate(hardwareId: string, deviceToken: string) {
    if (!hardwareId || !deviceToken) throw this.invalidCredential();
    const device = await this.hardwareDeviceModel
      .findOne({
        hardwareId: this.normalizeHardwareId(hardwareId),
        enabled: true,
      })
      .select('+secretHash');
    if (
      !device ||
      !this.safeEqual(device.secretHash, this.hashToken(deviceToken))
    ) {
      throw this.invalidCredential();
    }
    void this.hardwareDeviceModel
      .updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } })
      .catch(() => undefined);
    return {
      deviceId: device._id.toString(),
      hardwareId: device.hardwareId,
      ownerId: device.ownerId.toString(),
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private normalizeHardwareId(hardwareId: string) {
    return hardwareId.trim().toUpperCase();
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private invalidCredential() {
    return new UnauthorizedException({ code: 'DEVICE_CREDENTIAL_INVALID' });
  }
}
