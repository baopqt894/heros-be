import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AccountChallenge,
  AccountChallengeDocument,
} from './schemas/account-challenge.schema';
import { EmailService } from '../auth/email.service';
import { SosService } from '../sos/sos.service';
import { EmergencyContactsService } from '../emergency-contacts/emergency-contacts.service';
import { ConfirmAccountActionDto } from './account.dto';

@Injectable()
export class AccountService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountService.name);
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(AccountChallenge.name)
    private readonly challenges: Model<AccountChallengeDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly sos: SosService,
    private readonly contacts: EmergencyContactsService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.processDeletions(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async requestOtp(
    userId: string,
    purpose: 'phone_update' | 'account_delete',
    phone?: string
  ) {
    const user = await this.users.findOne({ _id: userId, status: 'active' });
    if (!user?.emailVerifiedAt)
      throw new ForbiddenException({ code: 'VERIFIED_EMAIL_REQUIRED' });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const target = purpose === 'phone_update' ? phone : user.email;
    const now = new Date();
    let challenge: AccountChallengeDocument;
    try {
      challenge = await this.challenges.findOneAndUpdate(
        { userId, purpose, resendAt: { $lte: now } },
        {
          $set: {
            target,
            codeHash: this.hash(userId, purpose, target, code),
            attempts: 0,
            expiresAt: new Date(Date.now() + 5 * 60_000),
            resendAt: new Date(Date.now() + 60_000),
          },
          $unset: { consumedAt: 1 },
        },
        { new: true, upsert: true, runValidators: true }
      );
    } catch (error) {
      if (error.code === 11000)
        throw new HttpException(
          { code: 'OTP_RESEND_TOO_SOON', retryAfterSeconds: 60 },
          429
        );
      throw error;
    }
    try {
      await this.email.sendOtp(user.email, code, 5, { purpose, phone });
    } catch (error) {
      await this.challenges.deleteOne({
        _id: challenge._id,
        codeHash: this.hash(userId, purpose, target, code),
      });
      throw error;
    }
    return {
      challengeId: challenge._id,
      deliveryChannel: 'email',
      purpose,
      expiresAt: challenge.expiresAt,
      resendAfterSeconds: 60,
      phoneOwnershipVerified: false,
    };
  }

  private hash(userId: string, purpose: string, target: string, code: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('OTP_HASH_SECRET')
    )
      .update(JSON.stringify([userId, purpose, target, code]))
      .digest('hex');
  }

  private async consume(
    userId: string,
    purpose: string,
    dto: ConfirmAccountActionDto
  ) {
    const challenge = await this.challenges
      .findOneAndUpdate(
        {
          _id: dto.challengeId,
          userId,
          purpose,
          expiresAt: { $gt: new Date() },
          consumedAt: { $exists: false },
          attempts: { $lt: 5 },
        },
        { $inc: { attempts: 1 } },
        { new: true }
      )
      .select('+codeHash');
    if (!challenge)
      throw new UnauthorizedException({ code: 'OTP_INVALID_OR_EXPIRED' });
    const expected = Buffer.from(
      this.hash(userId, purpose, challenge.target, dto.otp),
      'hex'
    );
    const actual = Buffer.from(challenge.codeHash, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new UnauthorizedException({ code: 'OTP_INVALID_OR_EXPIRED' });
    const result = await this.challenges.updateOne(
      {
        _id: challenge._id,
        codeHash: challenge.codeHash,
        consumedAt: { $exists: false },
      },
      { $set: { consumedAt: new Date() } }
    );
    if (!result.modifiedCount)
      throw new UnauthorizedException({ code: 'OTP_ALREADY_USED' });
    return challenge.target;
  }

  async updatePhone(userId: string, dto: ConfirmAccountActionDto) {
    const phone = await this.consume(userId, 'phone_update', dto);
    try {
      const user = await this.users.findOneAndUpdate(
        { _id: userId, status: 'active' },
        {
          $set: {
            phone,
            phoneUpdateAuthorizedAt: new Date(),
            phoneUpdateAuthorizationMethod: 'email_otp',
          },
          $unset: { phoneVerifiedAt: 1 },
        },
        { new: true }
      );
      if (!user) throw new NotFoundException('User not found');
      return {
        phone: user.phone,
        phoneOwnershipVerified: false,
        authorizationMethod: 'email_otp',
        authorizedAt: user.phoneUpdateAuthorizedAt,
      };
    } catch (error) {
      if (error.code === 11000)
        throw new ConflictException({ code: 'PHONE_ALREADY_REGISTERED' });
      throw error;
    }
  }

  async requestDeletion(userId: string, dto: ConfirmAccountActionDto) {
    await this.consume(userId, 'account_delete', dto);
    const result = await this.users.updateOne(
      { _id: userId, status: 'active' },
      {
        $set: { status: 'deleting', deletionRequestedAt: new Date() },
        $unset: { activeSessionKey: 1 },
      }
    );
    if (!result.modifiedCount) throw new NotFoundException('User not found');
    return { status: 'deletion_pending', accessRevoked: true };
  }

  async processDeletions() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      // Persisted account state is the retry queue; never remove it before all
      // child data and physical recordings have been successfully removed.
      const users = await this.users.find({ status: 'deleting' }).limit(50);
      for (const user of users) {
        try {
          const id = user._id;
          await this.sos.deleteOwnedData(id.toString());
          await this.connection
            .collection('emergency_contacts')
            .deleteMany({ $or: [{ ownerId: id }, { linkedUserId: id }] });
          await this.connection
            .collection('hardware_devices')
            .deleteMany({ ownerId: id });
          await this.connection
            .collection('devices')
            .deleteMany({ userId: id });
          await this.connection
            .collection('refresh_sessions')
            .deleteMany({ userId: id });
          await this.connection
            .collection('email_otp_challenges')
            .deleteMany({ email: user.email });
          await this.challenges.deleteMany({ userId: id });
          await this.users.deleteOne({ _id: id, status: 'deleting' });
          this.logger.log(`ACCOUNT_DELETION_COMPLETED id=${id}`);
        } catch {
          this.logger.error(`ACCOUNT_DELETION_RETRY id=${user._id}`);
        }
      }
    } catch {
      this.logger.error('ACCOUNT_DELETION_WORKER_FAILED');
    } finally {
      this.cleaning = false;
    }
  }

  async uploadAvatar(
    userId: string,
    file?: { buffer: Buffer; mimetype: string; size: number }
  ) {
    if (!file?.buffer?.length || file.size > 2 * 1024 * 1024)
      throw new BadRequestException({ code: 'AVATAR_INVALID' });
    const b = file.buffer;
    const valid =
      (file.mimetype === 'image/png' &&
        b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (file.mimetype === 'image/jpeg' &&
        b[0] === 0xff &&
        b[1] === 0xd8 &&
        b[2] === 0xff) ||
      (file.mimetype === 'image/webp' &&
        b.toString('ascii', 0, 4) === 'RIFF' &&
        b.toString('ascii', 8, 12) === 'WEBP');
    if (!valid) throw new BadRequestException({ code: 'AVATAR_TYPE_INVALID' });
    const avatarUrl = `/v1/profiles/${userId}/avatar`;
    const result = await this.users.updateOne(
      { _id: userId, status: 'active' },
      { $set: { avatarData: b, avatarMimeType: file.mimetype, avatarUrl } }
    );
    if (!result.matchedCount) throw new NotFoundException('User not found');
    return { avatarUrl };
  }

  async avatar(viewerId: string, ownerId: string) {
    if (!Types.ObjectId.isValid(ownerId)) throw new NotFoundException();
    if (
      viewerId !== ownerId &&
      !(await this.contacts.isAccepted(ownerId, viewerId)) &&
      !(await this.contacts.isAccepted(viewerId, ownerId))
    )
      throw new ForbiddenException();
    const user = await this.users
      .findOne({ _id: ownerId, status: 'active' })
      .select('+avatarData');
    if (!user?.avatarData) throw new NotFoundException('Avatar not found');
    return {
      buffer: Buffer.from(user.avatarData),
      mimeType: user.avatarMimeType,
    };
  }

  async deleteAvatar(userId: string) {
    await this.users.updateOne(
      { _id: userId, status: 'active' },
      { $unset: { avatarUrl: 1, avatarData: 1, avatarMimeType: 1 } }
    );
    return { deleted: true };
  }
}
