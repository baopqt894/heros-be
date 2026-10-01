import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreateEmergencyContactDto,
  UpdateEmergencyContactDto,
} from './dto/emergency-contact.dto';
import {
  EmergencyContact,
  EmergencyContactDocument,
} from './schemas/emergency-contact.schema';
import { UsersService } from '../users/users.service';

@Injectable()
export class EmergencyContactsService {
  private static readonly MAX_CONTACTS = 10;

  constructor(
    @InjectModel(EmergencyContact.name)
    private readonly contactModel: Model<EmergencyContactDocument>,
    private readonly usersService: UsersService
  ) {}

  list(ownerId: string) {
    return this.contactModel
      .find({ ownerId })
      .sort({ priority: 1, createdAt: 1 })
      .exec();
  }

  async create(ownerId: string, dto: CreateEmergencyContactDto) {
    const owner = await this.usersService.getMe(ownerId);
    if (owner.userType !== 'device_owner') {
      throw new BadRequestException({ code: 'DEVICE_OWNER_REQUIRED' });
    }
    if (!dto.phone && !dto.email) {
      throw new BadRequestException('At least one contact channel is required');
    }
    const contactCount = await this.contactModel.countDocuments({ ownerId });
    if (contactCount >= EmergencyContactsService.MAX_CONTACTS) {
      throw new BadRequestException({
        code: 'EMERGENCY_CONTACT_LIMIT_REACHED',
      });
    }
    const linkedUserId = await this.resolveLinkedUser(dto.linkedUserEmail);
    const { linkedUserEmail: _linkedUserEmail, ...contact } = dto;
    return this.contactModel.create({
      ...contact,
      ownerId: new Types.ObjectId(ownerId),
      email: dto.email?.trim().toLowerCase(),
      linkedUserId,
      invitationStatus: linkedUserId ? 'pending' : 'unlinked',
    });
  }

  async update(ownerId: string, id: string, dto: UpdateEmergencyContactDto) {
    this.assertObjectId(id);
    const { linkedUserEmail, ...contactFields } = dto;
    const update: Record<string, unknown> = { ...contactFields };
    let resetInvitationResponse = false;
    if (dto.email) update.email = dto.email.trim().toLowerCase();
    if (linkedUserEmail) {
      update.linkedUserId = await this.resolveLinkedUser(linkedUserEmail);
      update.invitationStatus = 'pending';
      resetInvitationResponse = true;
    }
    const contact = await this.contactModel.findOneAndUpdate(
      { _id: id, ownerId },
      resetInvitationResponse
        ? {
            $set: update,
            $unset: {
              invitationRespondedAt: 1,
              inviteTokenHash: 1,
              inviteExpiresAt: 1,
              inviteEmail: 1,
            },
          }
        : { $set: update },
      { new: true, runValidators: true }
    );
    if (!contact) throw new NotFoundException('Emergency contact not found');
    return contact;
  }

  async remove(ownerId: string, id: string) {
    this.assertObjectId(id);
    const result = await this.contactModel.deleteOne({ _id: id, ownerId });
    if (!result.deletedCount)
      throw new NotFoundException('Emergency contact not found');
    return { deleted: true };
  }

  listInvitations(userId: string) {
    return this.contactModel
      .find({ linkedUserId: userId, invitationStatus: 'pending' })
      .populate('ownerId', 'fullName avatarUrl email')
      .sort({ createdAt: -1 })
      .exec();
  }

  async respondToInvitation(
    userId: string,
    id: string,
    invitationStatus: 'accepted' | 'declined'
  ) {
    this.assertObjectId(id);
    const contact = await this.contactModel.findOneAndUpdate(
      { _id: id, linkedUserId: userId, invitationStatus: 'pending' },
      {
        $set: { invitationStatus, invitationRespondedAt: new Date() },
        $unset: { inviteTokenHash: 1, inviteExpiresAt: 1, inviteEmail: 1 },
      },
      { new: true }
    );
    if (!contact) {
      throw new NotFoundException('Emergency contact invitation not found');
    }
    return contact;
  }

  async unlink(userId: string, id: string) {
    this.assertObjectId(id);
    const contact = await this.contactModel.findOneAndUpdate(
      { _id: id, linkedUserId: userId },
      {
        $set: {
          invitationStatus: 'declined',
          invitationRespondedAt: new Date(),
        },
        $unset: { linkedUserId: 1 },
      },
      { new: true }
    );
    if (!contact)
      throw new NotFoundException('Emergency contact link not found');
    return { unlinked: true };
  }

  private assertObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Emergency contact not found');
    }
  }

  private async resolveLinkedUser(email?: string) {
    if (!email) return undefined;
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new BadRequestException({ code: 'LINKED_USER_NOT_FOUND' });
    }
    if (user.userType !== 'emergency_contact') {
      throw new BadRequestException({ code: 'LINKED_USER_TYPE_INVALID' });
    }
    return user._id;
  }
}
