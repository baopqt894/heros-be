import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createReadStream } from 'node:fs';
import {
  access,
  mkdir,
  readdir,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { EmergencyContactsService } from '../emergency-contacts/emergency-contacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import {
  AcknowledgeSosDto,
  CancelSosDto,
  CreateSosDto,
  UpdateSmsStatusDto,
  UpdateSosLocationDto,
  UploadSosRecordingDto,
} from './dto/sos.dto';
import { SosEvent, SosEventDocument } from './schemas/sos-event.schema';
import { SosGateway } from './sos.gateway';

const ACTIVE_STATUSES = ['active', 'acknowledged'];
const MAX_RECORDINGS_PER_SOS = 600;
const MAX_RECORDING_BYTES_PER_SOS = 100 * 1024 * 1024;
const RECORDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class SosService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SosService.name);
  private readonly recordingsDirectory: string;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleanupRunning = false;
  private cleanupStatus = { lastSuccessAt: null as string | null, failures: 0 };

  constructor(
    @InjectModel(SosEvent.name)
    private readonly sosModel: Model<SosEventDocument>,
    private readonly usersService: UsersService,
    private readonly contactsService: EmergencyContactsService,
    private readonly notificationsService: NotificationsService,
    private readonly gateway: SosGateway,
    config: ConfigService
  ) {
    this.recordingsDirectory =
      config.get<string>('SOS_RECORDINGS_DIR') ||
      join(process.cwd(), 'private_uploads', 'sos-recordings');
    if (
      config.get('NODE_ENV') === 'production' &&
      (!isAbsolute(this.recordingsDirectory) ||
        resolve(this.recordingsDirectory).startsWith(`${process.cwd()}/`))
    ) {
      throw new Error(
        'Production SOS_RECORDINGS_DIR must be an absolute persistent path outside the deployment directory'
      );
    }
  }

  onModuleInit() {
    void this.cleanupExpiredRecordings().catch(() =>
      this.logger.error('RECORDING_CLEANUP_FAILED')
    );
    this.cleanupTimer = setInterval(
      () =>
        void this.cleanupExpiredRecordings().catch(() =>
          this.logger.error('RECORDING_CLEANUP_FAILED')
        ),
      6 * 60 * 60 * 1000
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async create(ownerId: string, dto: CreateSosDto) {
    const owner = await this.usersService.getMe(ownerId);
    if (owner.userType !== 'device_owner') {
      throw new ForbiddenException({ code: 'SOS_DEVICE_OWNER_REQUIRED' });
    }
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

    const contacts = await this.contactsService.list(ownerId);
    const seenUsers = new Set<string>();
    const pushUserIds = new Set<string>();
    const recipients: Array<Record<string, unknown>> = [];
    for (const contact of contacts) {
      const invitationAccepted = contact.invitationStatus === 'accepted';
      const linkedUserId = invitationAccepted
        ? contact.linkedUserId?.toString()
        : undefined;
      if (linkedUserId) seenUsers.add(linkedUserId);
      if (contact.pushEnabled && linkedUserId) pushUserIds.add(linkedUserId);
      recipients.push({
        contactId: contact._id,
        type: 'emergency_contact',
        userId: linkedUserId ? new Types.ObjectId(linkedUserId) : undefined,
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
    const location = {
      type: 'Point' as const,
      coordinates: [dto.location.longitude, dto.location.latitude] as [
        number,
        number,
      ],
      accuracy: dto.location.accuracy,
      recordedAt,
      address: dto.location.address?.trim(),
    };
    let event: SosEventDocument;
    try {
      event = await this.sosModel.create({
        ownerId: new Types.ObjectId(ownerId),
        ownerName: owner.fullName || owner.email,
        ownerAvatarUrl: owner.avatarUrl,
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
      pushUserIds: [...pushUserIds],
      emails: contacts
        .filter((contact) => contact.emailEnabled && contact.email)
        .map((contact) => contact.email),
    });
    for (const recipientId of seenUsers) {
      if (!(await this.contactsService.isAccepted(ownerId, recipientId)))
        continue;
      await this.gateway.notifyUser(recipientId, 'sos.created', {
        id: event._id,
        code: event.code,
        ownerName: owner.fullName || 'Một người dùng',
        ownerAvatarUrl: owner.avatarUrl,
        currentLocation: location,
        startedAt: event.startedAt,
        message: event.message,
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

  async getIncomingActive(userId: string) {
    const events = await this.sosModel
      .find({
        status: { $in: ACTIVE_STATUSES },
        'recipients.userId': new Types.ObjectId(userId),
      })
      .sort({ startedAt: -1 })
      .exec();
    const visible = [];
    for (const event of events) {
      await this.filterRecipients(event);
      if (event.recipients.some((r) => r.userId?.toString() === userId)) {
        visible.push(await this.toMobileResponse(event, userId));
      }
    }
    return visible;
  }

  async getOne(userId: string, id: string) {
    const event = await this.findAccessible(userId, id);
    return this.toMobileResponse(event, userId);
  }

  async updateLocation(ownerId: string, id: string, dto: UpdateSosLocationDto) {
    this.assertObjectId(id);
    if (new Date(dto.recordedAt).getTime() > Date.now() + 60_000) {
      throw new BadRequestException({ code: 'LOCATION_TIME_INVALID' });
    }
    const location = {
      type: 'Point',
      coordinates: [dto.longitude, dto.latitude],
      accuracy: dto.accuracy,
      recordedAt: new Date(dto.recordedAt),
      address: dto.address?.trim(),
    };
    const event = await this.sosModel.findOneAndUpdate(
      {
        _id: id,
        ownerId,
        status: { $in: ACTIVE_STATUSES },
        'currentLocation.recordedAt': { $lt: location.recordedAt },
      },
      { $set: { currentLocation: location } },
      { new: true, runValidators: true }
    );
    if (!event) {
      const current = await this.sosModel.findOne({
        _id: id,
        ownerId,
        status: { $in: ACTIVE_STATUSES },
      });
      if (!current) throw new NotFoundException('Active SOS event not found');
      return this.toMobileResponse(current);
    }
    await this.notifyAcknowledgedRecipients(event, 'sos.location', {
      sosId: id,
      location,
    });
    return this.toMobileResponse(event);
  }

  async acknowledge(userId: string, id: string, dto: AcknowledgeSosDto = {}) {
    this.assertObjectId(id);
    const existing = await this.findAccessible(userId, id);
    const existingRecipient = existing.recipients.find(
      (recipient) => recipient.userId?.toString() === userId
    );
    if (!existingRecipient) {
      throw new ForbiddenException({ code: 'SOS_RECIPIENT_REQUIRED' });
    }
    if (existingRecipient.acknowledgedAt) {
      return this.toMobileResponse(existing, userId);
    }

    let event = await this.sosModel.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ACTIVE_STATUSES },
        recipients: {
          $elemMatch: {
            userId: new Types.ObjectId(userId),
            acknowledgedAt: { $exists: false },
          },
        },
      },
      {
        $set: {
          status: 'acknowledged',
          'recipients.$[recipient].acknowledgedAt': new Date(),
          ...(dto.supportMode
            ? { 'recipients.$[recipient].supportMode': dto.supportMode }
            : {}),
        },
      },
      {
        arrayFilters: [
          {
            'recipient.userId': new Types.ObjectId(userId),
            'recipient.acknowledgedAt': { $exists: false },
          },
        ],
        new: true,
      }
    );
    if (!event) {
      event = await this.sosModel.findById(id);
    }
    if (!event) throw new NotFoundException('SOS event not found');
    const acknowledged = event.recipients.some(
      (recipient) =>
        recipient.userId?.toString() === userId &&
        Boolean(recipient.acknowledgedAt)
    );
    if (!acknowledged) {
      throw new NotFoundException('Active SOS event not found');
    }
    await this.filterRecipients(event);
    const responderCount = this.responderCount(event);
    const payload = {
      sosId: event._id,
      userId,
      responderCount,
      supportMode: dto.supportMode,
    };
    await this.gateway.notifyUser(
      event.ownerId.toString(),
      'sos.acknowledged',
      payload
    );
    await this.notifyRecipients(event, 'sos.acknowledged', payload);
    return this.toMobileResponse(event, userId);
  }

  async addRecording(
    ownerId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    dto: UploadSosRecordingDto
  ) {
    this.assertObjectId(id);
    this.validateAudioFile(file);
    if (dto.clientRecordingId) {
      const previous = await this.sosModel.findOne({
        _id: id,
        ownerId,
        'recordings.clientRecordingId': dto.clientRecordingId,
      });
      const recording = previous?.recordings.find(
        (r) => r.clientRecordingId === dto.clientRecordingId
      );
      if (recording) return this.recordingResponse(id, recording);
    }
    const storageKey = `${randomUUID()}${this.extensionFor(file.mimetype)}`;
    await mkdir(this.recordingsDirectory, { recursive: true });
    const filePath = join(this.recordingsDirectory, storageKey);
    await writeFile(filePath, file.buffer, {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });

    const recording = {
      clientRecordingId: dto.clientRecordingId,
      _id: new Types.ObjectId(),
      uploaderId: new Types.ObjectId(ownerId),
      storageKey,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      durationSeconds: dto.durationSeconds,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + RECORDING_RETENTION_MS),
    };
    let event: SosEventDocument | null;
    try {
      event = await this.sosModel.findOneAndUpdate(
        {
          _id: id,
          ownerId,
          status: { $in: ACTIVE_STATUSES },
          ...(dto.clientRecordingId
            ? { 'recordings.clientRecordingId': { $ne: dto.clientRecordingId } }
            : {}),
          [`recordings.${MAX_RECORDINGS_PER_SOS - 1}`]: { $exists: false },
          $or: [
            { recordingBytes: { $exists: false } },
            {
              recordingBytes: {
                $lte: MAX_RECORDING_BYTES_PER_SOS - file.size,
              },
            },
          ],
        },
        {
          $push: { recordings: recording },
          $inc: { recordingBytes: file.size },
        },
        { new: true, runValidators: true }
      );
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    if (!event) {
      await unlink(filePath).catch(() => undefined);
      if (dto.clientRecordingId) {
        const previous = await this.sosModel.findOne({
          _id: id,
          ownerId,
          'recordings.clientRecordingId': dto.clientRecordingId,
        });
        const recording = previous?.recordings.find(
          (r) => r.clientRecordingId === dto.clientRecordingId
        );
        if (recording) return this.recordingResponse(id, recording);
      }
      const activeEvent = await this.sosModel.exists({
        _id: id,
        ownerId,
        status: { $in: ACTIVE_STATUSES },
      });
      if (activeEvent) {
        throw new ConflictException({ code: 'SOS_RECORDING_LIMIT_REACHED' });
      }
      throw new NotFoundException('Active SOS event not found');
    }

    const metadata = this.recordingResponse(id, recording);
    await this.filterRecipients(event);
    const acknowledgedIds = this.acknowledgedRecipientIds(event);
    await this.notifyAcknowledgedRecipients(event, 'sos.recording', {
      sosId: id,
      recording: metadata,
    });
    this.notificationsService.dispatchPush(
      acknowledgedIds,
      {
        type: 'SOS_RECORDING_AVAILABLE',
        sosId: id,
        recordingId: recording._id.toString(),
        message: 'Có bản ghi âm mới từ người cần hỗ trợ',
      },
      'Bản ghi âm SOS mới'
    );
    return metadata;
  }

  async openRecording(userId: string, id: string, recordingId: string) {
    this.assertObjectId(id);
    this.assertObjectId(recordingId);
    const event = await this.sosModel.findById(id);
    if (!event) throw new NotFoundException('SOS event not found');
    await this.filterRecipients(event);
    if (!this.canAccessSensitive(event, userId)) {
      throw new ForbiddenException({ code: 'SOS_ACKNOWLEDGEMENT_REQUIRED' });
    }
    const recording = event.recordings?.find(
      (item) => item._id.toString() === recordingId
    );
    if (!recording) throw new NotFoundException('SOS recording not found');
    const expiresAt =
      recording.expiresAt ||
      new Date(recording.createdAt.getTime() + RECORDING_RETENTION_MS);
    if (expiresAt <= new Date()) {
      throw new NotFoundException('SOS recording has expired');
    }
    const filePath = join(this.recordingsDirectory, recording.storageKey);
    try {
      await access(filePath);
    } catch {
      throw new NotFoundException('SOS recording file not found');
    }
    return {
      stream: createReadStream(filePath),
      mimeType: recording.mimeType,
      sizeBytes: recording.sizeBytes,
    };
  }

  async listOwnerRecordings(ownerId: string) {
    const events = await this.sosModel
      .find({ ownerId, 'recordings.0': { $exists: true } })
      .sort({ startedAt: -1 })
      .exec();
    return events.flatMap((event) =>
      (event.recordings || [])
        .filter((recording) => this.recordingUnexpired(recording))
        .map((recording) => ({
          sosId: event._id,
          sosCode: event.code,
          sosStatus: event.status,
          startedAt: event.startedAt,
          ...this.recordingResponse(event._id.toString(), recording),
        }))
    );
  }

  async deleteRecording(ownerId: string, id: string, recordingId: string) {
    this.assertObjectId(id);
    this.assertObjectId(recordingId);
    const event = await this.sosModel.findOne({ _id: id, ownerId });
    if (!event) throw new NotFoundException('SOS event not found');
    const recording = event.recordings?.find(
      (item) => item._id.toString() === recordingId
    );
    if (!recording) throw new NotFoundException('SOS recording not found');

    await this.sosModel.updateOne(
      { _id: event._id, 'recordings._id': recording._id },
      { $set: { 'recordings.$.expiresAt': new Date() } }
    );
    await this.removeStoredRecording(event, recording);
    return { deleted: true };
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
    await this.notifyRecipients(event, `sos.${status}`, {
      sosId: event._id,
      status,
    });
    const owner = await this.usersService.getMe(ownerId);
    this.notificationsService.dispatchPush(
      event.recipients
        .map((recipient) => recipient.userId?.toString())
        .filter(Boolean),
      {
        type: status === 'resolved' ? 'SOS_RESOLVED' : 'SOS_CANCELLED',
        sosId: event._id.toString(),
        message:
          status === 'resolved'
            ? `${owner.fullName || owner.email} đã xác nhận an toàn.`
            : `Tín hiệu SOS của ${owner.fullName || owner.email} đã được hủy.`,
      },
      status === 'resolved' ? 'Người dùng đã an toàn' : 'Tín hiệu SOS đã hủy'
    );
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
    await this.filterRecipients(event);
    if (
      event.ownerId.toString() !== userId &&
      !event.recipients.some((r) => r.userId?.toString() === userId)
    ) {
      throw new ForbiddenException({ code: 'SOS_ACCESS_REVOKED' });
    }
    return event;
  }

  private async notifyRecipients(
    event: SosEventDocument,
    name: string,
    payload: unknown
  ) {
    await this.filterRecipients(event);
    const ids = event.recipients
      .map((recipient) => recipient.userId?.toString())
      .filter(Boolean);
    for (const userId of ids)
      await this.gateway.notifyUser(userId, name, payload);
  }

  private async notifyAcknowledgedRecipients(
    event: SosEventDocument,
    name: string,
    payload: unknown
  ) {
    await this.filterRecipients(event);
    for (const userId of this.acknowledgedRecipientIds(event))
      await this.gateway.notifyUser(userId, name, payload);
  }

  private async filterRecipients(event: SosEventDocument) {
    const recipients = [];
    for (const recipient of event.recipients) {
      if (
        recipient.contactId &&
        !(await this.contactsService.exists(
          event.ownerId.toString(),
          recipient.contactId.toString()
        ))
      )
        continue;
      if (
        !recipient.userId ||
        (await this.contactsService.isAccepted(
          event.ownerId.toString(),
          recipient.userId.toString(),
          recipient.contactId?.toString()
        ))
      ) {
        recipients.push(recipient);
      }
    }
    event.recipients = recipients;
  }

  private async toMobileResponse(event: SosEventDocument, viewerId?: string) {
    await this.filterRecipients(event);
    const isOwner = !viewerId || event.ownerId.toString() === viewerId;
    const isRecipient = Boolean(
      viewerId &&
      event.recipients.some(
        (recipient) => recipient.userId?.toString() === viewerId
      )
    );
    const canAccessSensitive =
      isOwner || this.canAccessSensitive(event, viewerId);
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
      ownerName: event.ownerName || 'Người dùng HEROS',
      ownerAvatarUrl: event.ownerAvatarUrl,
      message: event.message,
      startedAt: event.startedAt,
      resolvedAt: event.resolvedAt,
      cancelledAt: event.cancelledAt,
      cancelReason: event.cancelReason,
      responderCount: this.responderCount(event),
      viewerAcknowledged: isOwner
        ? false
        : event.recipients.some(
            (recipient) =>
              recipient.userId?.toString() === viewerId &&
              Boolean(recipient.acknowledgedAt)
          ),
    };
    if (isOwner || isRecipient) {
      response.currentLocation = event.currentLocation;
      response.currentAddress = event.currentLocation.address;
    }
    if (canAccessSensitive) {
      response.recordings = (event.recordings || [])
        .filter((recording) => this.recordingUnexpired(recording))
        .map((recording) =>
          this.recordingResponse(event._id.toString(), recording)
        );
    }
    if (isOwner) {
      response.recipients = event.recipients;
      response.smsStatus = event.smsStatus;
      response.smsPayload = {
        recipients: phones,
        message: `${event.message}\nVị trí: ${this.mapUrl(latitude, longitude)}\nMã SOS: ${event.code}`,
      };
    }
    return response;
  }

  private canAccessSensitive(event: SosEventDocument, userId?: string) {
    if (!userId) return true;
    if (event.ownerId.toString() === userId) return true;
    if (!ACTIVE_STATUSES.includes(event.status)) return false;
    return event.recipients.some(
      (recipient) =>
        recipient.userId?.toString() === userId &&
        Boolean(recipient.acknowledgedAt)
    );
  }

  private acknowledgedRecipientIds(event: SosEventDocument) {
    return event.recipients
      .filter((recipient) => recipient.acknowledgedAt && recipient.userId)
      .map((recipient) => recipient.userId.toString());
  }

  private responderCount(event: SosEventDocument) {
    return this.acknowledgedRecipientIds(event).length;
  }

  private recordingResponse(
    sosId: string,
    recording: {
      _id: Types.ObjectId;
      mimeType: string;
      sizeBytes: number;
      durationSeconds: number;
      createdAt: Date;
      expiresAt?: Date;
    }
  ) {
    return {
      id: recording._id,
      mimeType: recording.mimeType,
      sizeBytes: recording.sizeBytes,
      durationSeconds: recording.durationSeconds,
      createdAt: recording.createdAt,
      expiresAt:
        recording.expiresAt ||
        new Date(recording.createdAt.getTime() + RECORDING_RETENTION_MS),
      playbackPath: `/v1/sos/${sosId}/recordings/${recording._id.toString()}`,
    };
  }

  private recordingUnexpired(recording: { createdAt: Date; expiresAt?: Date }) {
    return (
      (
        recording.expiresAt ||
        new Date(recording.createdAt.getTime() + RECORDING_RETENTION_MS)
      ).getTime() > Date.now()
    );
  }

  private async cleanupExpiredRecordings() {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    this.cleanupStatus.failures = 0;
    try {
      const now = new Date();
      const legacyCutoff = new Date(now.getTime() - RECORDING_RETENTION_MS);
      const events = await this.sosModel
        .find({
          $or: [
            { 'recordings.expiresAt': { $lte: now } },
            {
              recordings: {
                $elemMatch: {
                  expiresAt: { $exists: false },
                  createdAt: { $lte: legacyCutoff },
                },
              },
            },
          ],
        })
        .exec();
      for (const event of events) {
        const expired = event.recordings.filter((recording) => {
          const expiresAt =
            recording.expiresAt ||
            new Date(recording.createdAt.getTime() + RECORDING_RETENTION_MS);
          return expiresAt <= now;
        });
        if (!expired.length) continue;
        for (const recording of expired) {
          try {
            await this.removeStoredRecording(event, recording);
          } catch {
            this.cleanupStatus.failures++;
            this.logger.error(
              `RECORDING_DELETE_RETRY sos=${event._id} recording=${recording._id}`
            );
          }
        }
      }
      await this.cleanupOrphans();
      if (!this.cleanupStatus.failures)
        this.cleanupStatus.lastSuccessAt = new Date().toISOString();
    } catch (error) {
      this.cleanupStatus.failures++;
      throw error;
    } finally {
      this.cleanupRunning = false;
    }
  }

  private async cleanupOrphans() {
    await mkdir(this.recordingsDirectory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.recordingsDirectory)) {
      if (!/^[0-9a-f-]{36}\.(aac|m4a|mp3|ogg|wav)$/.test(name)) continue;
      const file = join(this.recordingsDirectory, name);
      try {
        const info = await stat(file);
        // Grace period protects files written just before their DB metadata.
        if (info.mtimeMs > Date.now() - 24 * 60 * 60_000) continue;
        if (!(await this.sosModel.exists({ 'recordings.storageKey': name })))
          await unlink(file);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.cleanupStatus.failures++;
          this.logger.error('ORPHAN_RECORDING_DELETE_RETRY');
        }
      }
    }
  }

  async storageHealth() {
    try {
      await mkdir(this.recordingsDirectory, { recursive: true, mode: 0o700 });
      await access(this.recordingsDirectory, constants.R_OK | constants.W_OK);
      const space = await statfs(this.recordingsDirectory);
      const availableBytes = space.bavail * space.bsize;
      return {
        status:
          availableBytes > 100 * 1024 * 1024 && !this.cleanupStatus.failures
            ? 'ok'
            : 'degraded',
        availableBytes,
        cleanup: this.cleanupStatus,
      };
    } catch {
      return {
        status: 'degraded',
        writable: false,
        cleanup: this.cleanupStatus,
      };
    }
  }

  private async removeStoredRecording(
    event: SosEventDocument,
    recording: SosEventDocument['recordings'][number]
  ) {
    try {
      await unlink(join(this.recordingsDirectory, recording.storageKey));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Keep metadata on IO failure so scheduled cleanup can retry. The predicate
    // makes the counter update safe when multiple workers delete the same clip.
    await this.sosModel.updateOne(
      { _id: event._id, 'recordings._id': recording._id },
      {
        $pull: { recordings: { _id: recording._id } },
        $inc: { recordingBytes: -recording.sizeBytes },
      }
    );
  }

  async deleteOwnedData(ownerId: string) {
    const events = await this.sosModel.find({ ownerId }).exec();
    for (const event of events) {
      await this.notifyRecipients(event, 'sos.cancelled', {
        sosId: event._id,
        status: 'cancelled',
        reason: 'account_deleted',
      });
      for (const recording of event.recordings || [])
        await this.removeStoredRecording(event, recording);
      await this.sosModel.deleteOne({ _id: event._id });
    }
    await this.sosModel.updateMany(
      { 'recipients.userId': ownerId },
      { $pull: { recipients: { userId: new Types.ObjectId(ownerId) } } }
    );
  }

  private extensionFor(mimeType: string) {
    const extensions: Record<string, string> = {
      'audio/aac': '.aac',
      'audio/m4a': '.m4a',
      'audio/mp4': '.m4a',
      'audio/mpeg': '.mp3',
      'audio/ogg': '.ogg',
      'audio/wav': '.wav',
      'audio/x-m4a': '.m4a',
    };
    const extension = extensions[mimeType];
    if (!extension) {
      throw new BadRequestException({ code: 'SOS_AUDIO_TYPE_INVALID' });
    }
    return extension;
  }

  private validateAudioFile(file: {
    buffer: Buffer;
    mimetype: string;
    size: number;
  }) {
    if (
      !file.buffer?.length ||
      file.size < 1 ||
      file.size !== file.buffer.length ||
      file.size > 10 * 1024 * 1024
    ) {
      throw new BadRequestException({ code: 'SOS_AUDIO_EMPTY' });
    }
    const bytes = file.buffer;
    const signatures: Record<string, boolean> = {
      'audio/aac':
        bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0,
      'audio/m4a':
        bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp',
      'audio/mp4':
        bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp',
      'audio/mpeg':
        bytes.subarray(0, 3).toString('ascii') === 'ID3' ||
        (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
      'audio/ogg': bytes.subarray(0, 4).toString('ascii') === 'OggS',
      'audio/wav':
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WAVE',
      'audio/x-m4a':
        bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp',
    };
    if (!signatures[file.mimetype]) {
      throw new BadRequestException({ code: 'SOS_AUDIO_TYPE_INVALID' });
    }
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
