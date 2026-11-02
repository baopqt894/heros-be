import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { ProvisionHardwareDeviceDto } from './dto/provision-hardware-device.dto';
import { UpdateHardwareStatusDto } from './dto/update-hardware-status.dto';
import { deviceActivationHash, normalizeDeviceActivationCode } from './device-activation-code';
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
    // Factory credentials must never be replaced by a mobile pairing call.
    throw new ForbiddenException({ code: 'HARDWARE_SELF_PROVISIONING_DISABLED' });
  }

  async activate(ownerId: string, activationCode: string) {
    const owner = await this.usersService.getMe(ownerId);
    if (owner.userType !== 'device_owner')
      throw new ForbiddenException({ code: 'SOS_DEVICE_OWNER_REQUIRED' });
    const normalized = normalizeDeviceActivationCode(activationCode);
    if (!normalized) throw new BadRequestException({ code: 'DEVICE_ACTIVATION_INVALID' });
    const hash = deviceActivationHash(normalized);
    const device = await this.hardwareDeviceModel.findOneAndUpdate(
      { ownerId: new Types.ObjectId(ownerId), enabled: true, activationPending: true, activationCodeHash: hash },
      { $set: { activationPending: false, activatedAt: new Date(), activationUsedHash: hash }, $unset: { activationCodeHash: 1 } },
      { new: true, runValidators: true }
    );
    const current = device || await this.hardwareDeviceModel.findOne({
      ownerId: new Types.ObjectId(ownerId), enabled: true,
      activationPending: { $ne: true }, activationUsedHash: hash,
    });
    if (!current) throw new BadRequestException({ code: 'DEVICE_ACTIVATION_INVALID' });
    return {
      device: { id: current._id.toString(), hardwareId: current.hardwareId },
      activated: true,
      alreadyActivated: !device,
    };
  }

  list(ownerId: string) {
    return this.hardwareDeviceModel
      .find({ ownerId: new Types.ObjectId(ownerId), activationPending: { $ne: true } })
      .sort({ createdAt: -1 });
  }

  async updateStatus(deviceId: string, dto: UpdateHardwareStatusDto) {
    const batteryReportedAt = new Date();
    const device = await this.hardwareDeviceModel.findByIdAndUpdate(
      deviceId,
      { $set: { ...dto, batteryReportedAt, lastSeenAt: batteryReportedAt } },
      { new: true, runValidators: true }
    );
    if (!device) throw new NotFoundException('Hardware device not found');
    return {
      hardwareId: device.hardwareId,
      batteryPercent: device.batteryPercent,
      isCharging: device.isCharging,
      estimatedMinutesRemaining: device.estimatedMinutesRemaining,
      batteryReportedAt: device.batteryReportedAt,
    };
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
    if (typeof hardwareId !== 'string' || typeof deviceToken !== 'string' || !hardwareId || !deviceToken) throw this.invalidCredential();
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
    if (device.activationPending)
      throw new ForbiddenException({ code: 'DEVICE_ACTIVATION_REQUIRED' });
    const owner = await this.usersService.findById(device.ownerId.toString());
    if (!owner || owner.status !== 'active') throw this.invalidCredential();
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
