import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ContactMessage, ContactMessageDocument } from './contact.schema';
import { CreateContactDto } from './contact.dto';

@Injectable()
export class ContactService {
  constructor(
    @InjectModel(ContactMessage.name)
    private readonly messages: Model<ContactMessageDocument>,
    private readonly config: ConfigService
  ) {}
  async create(input: CreateContactDto) {
    try {
      const row = await this.messages.create({
        name: input.name,
        email: input.email,
        phone: input.phone || '',
        message: input.message,
        createdAt: new Date(),
      });
      return { id: row._id.toString(), createdAt: row.createdAt.toISOString() };
    } catch {
      throw new ServiceUnavailableException({
        code: 'CONTACT_STORAGE_UNAVAILABLE',
      });
    }
  }
  async export(authorization: string | undefined, raw = '0') {
    const key = this.config.get<string>('HEROS_FEEDBACK_EXPORT_KEY');
    if (!key || key.length < 32)
      throw new ServiceUnavailableException({ code: 'EXPORT_NOT_CONFIGURED' });
    const token = authorization?.match(/^Bearer (.+)$/)?.[1] || '';
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    if (!token || !timingSafeEqual(digest(key), digest(token)))
      throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    const after = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after))
      throw new BadRequestException({ code: 'INVALID_CURSOR' });
    try {
      const rows = await this.messages
        .find()
        .sort({ _id: 1 })
        .skip(after)
        .limit(201)
        .select('_id name email phone message createdAt')
        .lean()
        .exec();
      const messages = rows.slice(0, 200).map((row) => ({
        id: row._id.toString(),
        name: row.name,
        email: row.email,
        phone: row.phone,
        message: row.message,
        createdAt: row.createdAt.toISOString(),
      }));
      return {
        messages,
        nextCursor: after + messages.length,
        hasMore: rows.length > 200,
      };
    } catch {
      throw new ServiceUnavailableException({
        code: 'CONTACT_STORAGE_UNAVAILABLE',
      });
    }
  }
}
