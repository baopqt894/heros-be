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

@Injectable()
export class EmergencyContactsService {
  constructor(
    @InjectModel(EmergencyContact.name)
    private readonly contactModel: Model<EmergencyContactDocument>
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
    return this.contactModel.create({
      ...dto,
      ownerId: new Types.ObjectId(ownerId),
      email: dto.email?.trim().toLowerCase(),
    });
  }

  async update(ownerId: string, id: string, dto: UpdateEmergencyContactDto) {
    this.assertObjectId(id);
    const update: Record<string, unknown> = { ...dto };
    if (dto.email) update.email = dto.email.trim().toLowerCase();
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
}
