import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import {
  EmergencyContact,
  EmergencyContactDocument,
} from './schemas/emergency-contact.schema';

@Injectable()
export class ContactInvitesService {
  constructor(
    @InjectModel(EmergencyContact.name)
    private readonly contacts: Model<EmergencyContactDocument>,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly limits: AuthRateLimitService
  ) {}

  async issue(ownerId: string, id: string, email: string) {
    this.limits.consume(`invite-issue:${ownerId}`, 20, 60_000);
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Contact not found');
    const owner = await this.users.getMe(ownerId);
    if (owner.userType !== 'device_owner')
      throw new BadRequestException({ code: 'DEVICE_OWNER_REQUIRED' });
    const base = new URL(
      this.config.get<string>('APP_INVITE_BASE_URL') ||
        'https://heros.nextteam.site/invite'
    );
    if (base.protocol !== 'https:')
      throw new BadRequestException('Invite base URL must use HTTPS');
    base.search = '';
    base.hash = '';
    const code = randomBytes(16).toString('hex').toUpperCase();
    const ttl = Number(this.config.get('INVITE_TTL_DAYS') || 7);
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > 30)
      throw new BadRequestException('INVITE_TTL_DAYS must be between 1 and 30');
    const expiresAt = new Date(Date.now() + ttl * 86_400_000);
    const contact = await this.contacts.findOneAndUpdate(
      { _id: id, ownerId, invitationStatus: { $ne: 'accepted' } },
      {
        $set: {
          inviteTokenHash: this.hash(code),
          inviteEmail: email.trim().toLowerCase(),
          inviteExpiresAt: expiresAt,
          invitationStatus: 'pending',
        },
        $unset: { linkedUserId: 1, invitationRespondedAt: 1 },
      },
      { new: true }
    );
    if (!contact) throw new NotFoundException('Unaccepted contact not found');
    // Keep credentials out of HTTP paths, access logs and Referer headers.
    base.hash = `code=${code}`;
    return {
      contactId: contact._id,
      inviteCode: code,
      inviteUrl: base.toString(),
      expiresAt,
    };
  }

  async accept(userId: string, rawCode: string) {
    this.limits.consume(`invite-accept:${userId}`, 10, 60_000);
    const user = await this.users.getMe(userId);
    if (user.userType !== 'emergency_contact' || !user.emailVerifiedAt) {
      throw new BadRequestException({
        code: 'VERIFIED_EMERGENCY_CONTACT_REQUIRED',
      });
    }
    const contact = await this.contacts.findOneAndUpdate(
      {
        inviteTokenHash: this.hash(rawCode.trim().toUpperCase()),
        inviteEmail: user.email.trim().toLowerCase(),
        inviteExpiresAt: { $gt: new Date() },
        invitationStatus: 'pending',
        ownerId: { $ne: user._id },
      },
      {
        $set: {
          linkedUserId: user._id,
          invitationStatus: 'accepted',
          invitationRespondedAt: new Date(),
        },
        $unset: { inviteTokenHash: 1, inviteExpiresAt: 1, inviteEmail: 1 },
      },
      { new: true }
    );
    if (!contact)
      throw new BadRequestException({ code: 'INVITE_INVALID_OR_EXPIRED' });
    return contact;
  }

  async revoke(ownerId: string, id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Contact not found');
    const result = await this.contacts.updateOne(
      { _id: id, ownerId, invitationStatus: 'pending' },
      {
        $set: { invitationStatus: 'unlinked' },
        $unset: {
          inviteTokenHash: 1,
          inviteExpiresAt: 1,
          inviteEmail: 1,
          linkedUserId: 1,
        },
      }
    );
    if (!result.matchedCount)
      throw new NotFoundException('Pending invitation not found');
    return { revoked: true };
  }

  private hash(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }
}
