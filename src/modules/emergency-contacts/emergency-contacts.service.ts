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
    if (!dto.phone && !dto.email) {
      throw new BadRequestException('At least one contact channel is required');
    }
    const linkedUserId = await this.resolveLinkedUser(dto.linkedUserEmail);
    const { linkedUserEmail: _linkedUserEmail, ...contact } = dto;
    return this.contactModel.create({
      ...contact,
      ownerId: new Types.ObjectId(ownerId),
      email: dto.email?.trim().toLowerCase(),
      linkedUserId,
    });
  }

  async update(ownerId: string, id: string, dto: UpdateEmergencyContactDto) {
    this.assertObjectId(id);
    const { linkedUserEmail, ...contactFields } = dto;
    const update: Record<string, unknown> = { ...contactFields };
    if (dto.email) update.email = dto.email.trim().toLowerCase();
    if (linkedUserEmail) {
      update.linkedUserId = await this.resolveLinkedUser(linkedUserEmail);
    }
    const contact = await this.contactModel.findOneAndUpdate(
      { _id: id, ownerId },
      { $set: update },
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
