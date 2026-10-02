import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { User, UserDocument } from './schemas/user.schema';
import { UserType } from './user-type';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>
  ) {}

  async onModuleInit() {
    await this.userModel.updateMany(
      { userType: { $exists: false } },
      { $set: { userType: 'device_owner' } }
    );
  }

  findById(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.userModel.findById(id).exec();
  }

  findByEmail(email: string) {
    return this.userModel.findOne({ email: this.normalizeEmail(email) }).exec();
  }

  findByEmailWithPassword(email: string) {
    return this.userModel
      .findOne({ email: this.normalizeEmail(email) })
      .select('+passwordHash')
      .exec();
  }

  findByGoogleSubject(subject: string) {
    return this.userModel.findOne({ googleSubject: subject }).exec();
  }

  findByAppleSubject(appleSubject: string) {
    return this.userModel.findOne({ appleSubject }).exec();
  }

  async activateSession(id: string, sessionKey: string) {
    const result = await this.userModel.updateOne(
      { _id: id, status: 'active' },
      { $set: { activeSessionKey: sessionKey } }
    );
    if (!result.matchedCount)
      throw new UnauthorizedException('Account is unavailable');
  }

  async assertSession(id: string, sessionKey?: string) {
    if (
      !Types.ObjectId.isValid(id) ||
      !sessionKey ||
      !(await this.userModel.exists({
        _id: id,
        status: 'active',
        activeSessionKey: sessionKey,
      }))
    ) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED' });
    }
  }

  async revokeSession(id: string, sessionKey: string) {
    await this.userModel.updateOne(
      { _id: id, activeSessionKey: sessionKey },
      { $unset: { activeSessionKey: 1 } }
    );
  }

  createEmailUser(
    email: string,
    profile: {
      fullName?: string;
      dateOfBirth?: string;
      gender?: string;
      phone?: string;
      passwordHash?: string;
      userType?: UserType;
    } = {}
  ) {
    return this.userModel.create({
      email: this.normalizeEmail(email),
      emailVerifiedAt: new Date(),
      fullName: profile.fullName || '',
      dateOfBirth: profile.dateOfBirth
        ? new Date(profile.dateOfBirth)
        : undefined,
      gender: profile.gender,
      phone: profile.phone?.trim(),
      passwordHash: profile.passwordHash,
      userType: profile.userType,
    });
  }

  async getMe(id: string) {
    const user = await this.findById(id);
    if (!user || user.status !== 'active')
      throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(id: string, dto: UpdateUserDto) {
    if (dto.responderEnabled) {
      const existing = await this.getMe(id);
      if (existing.userType !== 'community_responder') {
        throw new BadRequestException({
          code: 'COMMUNITY_RESPONDER_ACCOUNT_REQUIRED',
        });
      }
    }
    const update: Record<string, unknown> = { ...dto };
    if (dto.phone !== undefined) {
      throw new BadRequestException({
        code: 'PHONE_VERIFICATION_REQUIRED',
        message: 'Use the phone verification endpoints to change your phone.',
      });
    }
    if (dto.dateOfBirth) update.dateOfBirth = new Date(dto.dateOfBirth);
    const user = await this.userModel
      .findOneAndUpdate(
        { _id: id, status: 'active' },
        { $set: update },
        { new: true }
      )
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async setPassword(id: string, passwordHash: string) {
    const user = await this.userModel
      .findOneAndUpdate(
        { _id: id, status: 'active' },
        { $set: { passwordHash } },
        { new: true }
      )
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateLocation(id: string, dto: UpdateLocationDto) {
    const user = await this.userModel
      .findOneAndUpdate(
        { _id: id, status: 'active' },
        {
          $set: {
            lastLocation: {
              type: 'Point',
              coordinates: [dto.longitude, dto.latitude],
              accuracy: dto.accuracy,
              recordedAt: new Date(dto.recordedAt),
            },
          },
        },
        { new: true }
      )
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user.lastLocation;
  }

  findNearbyResponders(
    ownerId: string,
    longitude: number,
    latitude: number,
    maxDistance: number,
    limit = 50
  ) {
    return this.userModel
      .find({
        _id: { $ne: new Types.ObjectId(ownerId) },
        status: 'active',
        userType: 'community_responder',
        responderEnabled: true,
        'lastLocation.recordedAt': {
          $gt: new Date(Date.now() - 30 * 60_000),
        },
        lastLocation: {
          $near: {
            $geometry: { type: 'Point', coordinates: [longitude, latitude] },
            $maxDistance: maxDistance,
          },
        },
      })
      .limit(Math.max(limit * 4, limit))
      .exec()
      .then((users) =>
        users
          .filter((user) => {
            const [userLongitude, userLatitude] = user.lastLocation.coordinates;
            return (
              this.distanceMeters(
                latitude,
                longitude,
                userLatitude,
                userLongitude
              ) <= user.responderRadiusMeters
            );
          })
          .slice(0, limit)
      );
  }

  normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private distanceMeters(
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number
  ) {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const deltaLatitude = radians(latitudeB - latitudeA);
    const deltaLongitude = radians(longitudeB - longitudeA);
    const a =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(radians(latitudeA)) *
        Math.cos(radians(latitudeB)) *
        Math.sin(deltaLongitude / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
