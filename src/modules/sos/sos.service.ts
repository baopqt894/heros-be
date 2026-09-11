import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { EmergencyContactsService } from '../emergency-contacts/emergency-contacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import {
  CancelSosDto,
  CreateSosDto,
  UpdateSmsStatusDto,
  UpdateSosLocationDto,
} from './dto/sos.dto';
import { SosEvent, SosEventDocument } from './schemas/sos-event.schema';
import { SosGateway } from './sos.gateway';

const ACTIVE_STATUSES = ['active', 'acknowledged'];

@Injectable()
export class SosService {
  constructor(
    @InjectModel(SosEvent.name)
    private readonly sosModel: Model<SosEventDocument>,
    private readonly usersService: UsersService,
    private readonly contactsService: EmergencyContactsService,
    private readonly notificationsService: NotificationsService,
    private readonly gateway: SosGateway
  ) {}

  async create(ownerId: string, dto: CreateSosDto) {
    const existing = await this.sosModel.findOne({
      ownerId,
      clientRequestId: dto.clientRequestId,
    });
    if (existing) return this.toMobileResponse(existing);

    const recentCount = await this.sosModel.countDocuments({
      ownerId,
      startedAt: { $gt: new Date(Date.now() - 10 * 60_000) },
    });
    if (recentCount >= 5) {
      throw new HttpException(
        { code: 'SOS_RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const currentlyActive = await this.sosModel.exists({
      ownerId,
      status: { $in: ACTIVE_STATUSES },
    });
    if (currentlyActive) {
      throw new ConflictException({ code: 'SOS_ALREADY_ACTIVE' });
    }

    const recordedAt = new Date(dto.location.recordedAt);
    if (recordedAt.getTime() > Date.now() + 60_000) {
      throw new BadRequestException({ code: 'LOCATION_TIME_INVALID' });
    }

    const [owner, contacts, nearby] = await Promise.all([
      this.usersService.getMe(ownerId),
      this.contactsService.list(ownerId),
      this.usersService.findNearbyResponders(
        ownerId,
        dto.location.longitude,
        dto.location.latitude,
        5000
      ),
    ]);
    const seenUsers = new Set<string>();
    const recipients: Array<Record<string, unknown>> = [];
    for (const contact of contacts) {
      const linkedUserId = contact.linkedUserId?.toString();
      if (linkedUserId) seenUsers.add(linkedUserId);
      recipients.push({
        type: 'emergency_contact',
        userId: contact.linkedUserId,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        channels: [
          ...(contact.pushEnabled && linkedUserId ? ['push'] : []),
          ...(contact.emailEnabled && contact.email ? ['email'] : []),
          ...(contact.phone ? ['sms_composer'] : []),
        ],
      });
    }
    for (const responder of nearby) {
      const responderId = responder._id.toString();
      if (seenUsers.has(responderId)) continue;
      seenUsers.add(responderId);
      recipients.push({
        type: 'nearby_responder',
        userId: responder._id,
        name: responder.fullName,
        channels: ['push'],
      });
    }

    const location = {
      type: 'Point' as const,
      coordinates: [dto.location.longitude, dto.location.latitude] as [
        number,
        number,
      ],
      accuracy: dto.location.accuracy,
      recordedAt,
    };
    let event: SosEventDocument;
    try {
      event = await this.sosModel.create({
        ownerId: new Types.ObjectId(ownerId),
        code: this.createCode(),
        clientRequestId: dto.clientRequestId,
        message: dto.message.trim(),
        initialLocation: location,
        currentLocation: location,
        recipients,
        startedAt: new Date(),
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        const winner = await this.sosModel.findOne({
          ownerId,
          clientRequestId: dto.clientRequestId,
        });
        if (winner) return this.toMobileResponse(winner);
      }
      throw error;
    }

    const mapUrl = this.mapUrl(dto.location.latitude, dto.location.longitude);
    this.notificationsService.dispatchSos({
      eventId: event._id.toString(),
      code: event.code,
      ownerName: owner.fullName || owner.email,
      message: event.message,
      mapUrl,
      pushUserIds: [...seenUsers],
      emails: contacts
        .filter((contact) => contact.emailEnabled && contact.email)
        .map((contact) => contact.email),
    });
    for (const recipientId of seenUsers) {
      this.gateway.notifyUser(recipientId, 'sos.created', {
        id: event._id,
        code: event.code,
        ownerName: owner.fullName || 'Một người dùng',
        message: event.message,
        location,
      });
    }
    return this.toMobileResponse(event);
  }

  async getActive(ownerId: string) {
    const event = await this.sosModel
      .findOne({ ownerId, status: { $in: ACTIVE_STATUSES } })
      .sort({ startedAt: -1 });
    return event ? this.toMobileResponse(event) : null;
  }

  async getOne(userId: string, id: string) {
    const event = await this.findAccessible(userId, id);
    return this.toMobileResponse(event, event.ownerId.toString() === userId);
  }

  async updateLocation(ownerId: string, id: string, dto: UpdateSosLocationDto) {
    this.assertObjectId(id);
    const location = {
      type: 'Point',
      coordinates: [dto.longitude, dto.latitude],
      accuracy: dto.accuracy,
      recordedAt: new Date(dto.recordedAt),
    };
    const event = await this.sosModel.findOneAndUpdate(
      { _id: id, ownerId, status: { $in: ACTIVE_STATUSES } },
      { $set: { currentLocation: location } },
      { new: true, runValidators: true }
    );
    if (!event) throw new NotFoundException('Active SOS event not found');
    this.notifyRecipients(event, 'sos.location', { sosId: id, location });
    return this.toMobileResponse(event);
  }

  async acknowledge(userId: string, id: string) {
    this.assertObjectId(id);
    const event = await this.sosModel.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ACTIVE_STATUSES },
        'recipients.userId': new Types.ObjectId(userId),
      },
      {
        $set: {
          status: 'acknowledged',
          'recipients.$[recipient].acknowledgedAt': new Date(),
        },
      },
      {
        arrayFilters: [{ 'recipient.userId': new Types.ObjectId(userId) }],
        new: true,
      }
    );
    if (!event) throw new NotFoundException('SOS event not found');
    this.gateway.notifyUser(event.ownerId.toString(), 'sos.acknowledged', {
      sosId: event._id,
      userId,
    });
    return this.toMobileResponse(event, false);
  }

  async resolve(ownerId: string, id: string) {
    return this.finish(ownerId, id, 'resolved');
  }

  async cancel(ownerId: string, id: string, dto: CancelSosDto) {
    return this.finish(ownerId, id, 'cancelled', dto.reason);
  }

  async updateSmsStatus(ownerId: string, id: string, dto: UpdateSmsStatusDto) {
    this.assertObjectId(id);
    const event = await this.sosModel.findOneAndUpdate(
      { _id: id, ownerId },
      { $set: { smsStatus: dto.status } },
      { new: true }
    );
    if (!event) throw new NotFoundException('SOS event not found');
    return { smsStatus: event.smsStatus };
  }

  private async finish(
    ownerId: string,
    id: string,
    status: 'resolved' | 'cancelled',
    cancelReason?: string
  ) {
    this.assertObjectId(id);
    const timestampField = status === 'resolved' ? 'resolvedAt' : 'cancelledAt';
    const event = await this.sosModel.findOneAndUpdate(
      { _id: id, ownerId, status: { $in: ACTIVE_STATUSES } },
      {
        $set: {
          status,
          [timestampField]: new Date(),
          ...(status === 'cancelled' && cancelReason ? { cancelReason } : {}),
        },
      },
      { new: true }
    );
    if (!event) throw new NotFoundException('Active SOS event not found');
    this.notifyRecipients(event, `sos.${status}`, { sosId: event._id, status });
    return this.toMobileResponse(event);
  }

  private async findAccessible(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('SOS event not found');
    const event = await this.sosModel.findOne({
      _id: id,
      $or: [
        { ownerId: userId },
        { 'recipients.userId': new Types.ObjectId(userId) },
      ],
    });
    if (!event) throw new NotFoundException('SOS event not found');
    return event;
  }

  private notifyRecipients(
    event: SosEventDocument,
    name: string,
    payload: unknown
  ) {
    const ids = event.recipients
      .map((recipient) => recipient.userId?.toString())
      .filter(Boolean);
    ids.forEach((userId) => this.gateway.notifyUser(userId, name, payload));
  }

  private toMobileResponse(event: SosEventDocument, includePrivate = true) {
    const [longitude, latitude] = event.currentLocation.coordinates;
    const phones = event.recipients
      .filter(
        (recipient) => recipient.type === 'emergency_contact' && recipient.phone
      )
      .map((recipient) => recipient.phone);
    const response: Record<string, unknown> = {
      id: event._id,
      code: event.code,
      status: event.status,
      message: event.message,
      currentLocation: event.currentLocation,
      startedAt: event.startedAt,
      resolvedAt: event.resolvedAt,
      cancelledAt: event.cancelledAt,
      cancelReason: event.cancelReason,
    };
    if (includePrivate) {
      response.recipients = event.recipients;
      response.smsStatus = event.smsStatus;
      response.smsPayload = {
        recipients: phones,
        message: `${event.message}\nVị trí: ${this.mapUrl(latitude, longitude)}\nMã SOS: ${event.code}`,
      };
    }
    return response;
  }

  private mapUrl(latitude: number, longitude: number) {
    return `https://maps.google.com/?q=${latitude},${longitude}`;
  }

  private createCode() {
    return `SOS-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private assertObjectId(id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('SOS event not found');
  }
}
