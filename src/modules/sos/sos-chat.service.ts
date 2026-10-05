import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SosEvent, SosEventDocument } from './schemas/sos-event.schema';
import { SosChatMessage } from './schemas/sos-chat-message.schema';
import { SosService } from './sos.service';
import {
  ListSosChatMessagesDto,
  ListSosChatsDto,
  SendSosChatMessageDto,
} from './dto/sos-chat.dto';

const ACTIVE = ['active', 'acknowledged'];
const MAX_MESSAGES = 1000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;

@Injectable()
export class SosChatService {
  private readonly logger = new Logger(SosChatService.name);
  constructor(
    @InjectModel(SosEvent.name)
    private readonly events: Model<SosEventDocument>,
    private readonly sos: SosService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService
  ) {}

  async list(userId: string, query: ListSosChatsDto) {
    const candidates = await this.events
      .find({
        ...(query.status === 'closed'
          ? { ownerId: userId, status: { $in: ['resolved', 'cancelled'] } }
          : {
              status: { $in: ACTIVE },
              $or: [
                { ownerId: userId },
                {
                  recipients: {
                    $elemMatch: {
                      userId: new Types.ObjectId(userId),
                      acknowledgedAt: { $exists: true },
                    },
                  },
                },
              ],
            }),
        ...(query.before
          ? { _id: { $lt: new Types.ObjectId(query.before) } }
          : {}),
      })
      .sort({ _id: -1 })
      .limit(query.limit + 1);
    const items = [];
    for (const candidate of candidates.slice(0, query.limit)) {
      try {
        const event = await this.sos.getChatContext(userId, candidate.id);
        items.push(this.summary(event));
      } catch (error) {
        if (!(
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        ))
          throw error;
      }
    }
    return {
      items,
      nextCursor:
        candidates.length > query.limit ? candidates[query.limit - 1].id : null,
    };
  }

  async get(userId: string, id: string) {
    const event = await this.sos.getChatContext(userId, id);
    const members = await this.members(event);
    const snapshot = await this.sos.getOne(userId, id);
    // Resolution/unlink can race the snapshot query; never return a stale grant.
    const current = await this.sos.getChatContext(userId, id);
    return {
      ...this.summary(current),
      members,
      canSend: ACTIVE.includes(current.status),
      currentLocation: snapshot.currentLocation,
      currentAddress: snapshot.currentAddress,
      recordings: snapshot.recordings || [],
      messagesPath: `/v1/sos-chats/${id}/messages`,
    };
  }

  async messages(userId: string, id: string, query: ListSosChatMessagesDto) {
    if (
      query.beforeSequence !== undefined &&
      query.afterSequence !== undefined
    ) {
      throw new BadRequestException({ code: 'CHAT_CURSOR_CONFLICT' });
    }
    await this.sos.getChatContext(userId, id);
    const event = await this.events
      .findById(id)
      .select('chatMessages chatSequence ownerId');
    if (!event) throw new NotFoundException('SOS chat not found');
    let messages = (event.chatMessages || []).filter(
      (m) => m.expiresAt > new Date()
    );
    const forward = query.afterSequence !== undefined;
    messages = messages.filter((m) =>
      forward
        ? m.sequence > query.afterSequence
        : query.beforeSequence === undefined ||
          m.sequence < query.beforeSequence
    );
    messages.sort((a, b) =>
      forward ? a.sequence - b.sequence : b.sequence - a.sequence
    );
    const hasMore = messages.length > query.limit;
    messages = messages
      .slice(0, query.limit)
      .sort((a, b) => a.sequence - b.sequence);
    const profiles = await this.profiles(
      messages.map((m) => m.senderId.toString())
    );
    await this.sos.getChatContext(userId, id);
    return {
      items: messages.map((m) =>
        this.messageResponse(id, m, profiles.get(m.senderId.toString()))
      ),
      hasMore,
      nextBeforeSequence: !forward && hasMore ? messages[0].sequence : null,
      nextAfterSequence: forward && hasMore ? messages.at(-1).sequence : null,
      lastSequence: event.chatSequence || 0,
    };
  }

  async send(userId: string, id: string, dto: SendSosChatMessageDto) {
    await this.sos.getChatContext(userId, id, true);
    const previous = await this.findPrevious(id, userId, dto.clientMessageId);
    if (previous) return this.retryResponse(userId, id, previous, dto.text);
    const now = new Date();
    const senderId = new Types.ObjectId(userId);
    const message = {
      _id: new Types.ObjectId(),
      senderId,
      clientMessageId: dto.clientMessageId,
      text: dto.text,
      createdAt: now,
      expiresAt: new Date(now.getTime() + RETENTION_MS),
    };
    // The sequence, append, idempotency, rate limit and active-status guard are
    // evaluated on the same MongoDB document, including across API instances.
    const event = await this.events
      .findOneAndUpdate(
        {
          _id: id,
          status: { $in: ACTIVE },
          [`chatMessages.${MAX_MESSAGES - 1}`]: { $exists: false },
          chatMessages: {
            $not: {
              $elemMatch: { senderId, clientMessageId: dto.clientMessageId },
            },
          },
          $expr: {
            $lt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$chatMessages', []] },
                    as: 'm',
                    cond: {
                      $and: [
                        { $eq: ['$$m.senderId', senderId] },
                        {
                          $gt: [
                            '$$m.createdAt',
                            new Date(now.getTime() - 60_000),
                          ],
                        },
                      ],
                    },
                  },
                },
              },
              30,
            ],
          },
        },
        [
          {
            $set: {
              chatSequence: { $add: [{ $ifNull: ['$chatSequence', 0] }, 1] },
            },
          },
          {
            $set: {
              chatMessages: {
                $concatArrays: [
                  { $ifNull: ['$chatMessages', []] },
                  [
                    {
                      $mergeObjects: [
                        { $literal: message },
                        { sequence: '$chatSequence' },
                      ],
                    },
                  ],
                ],
              },
            },
          },
        ],
        {
          new: true,
          projection: { chatMessages: { $slice: -1 }, chatSequence: 1 },
        }
      )
      .select('+chatMessages');
    if (!event) {
      await this.sos.getChatContext(userId, id, true);
      const winner = await this.findPrevious(id, userId, dto.clientMessageId);
      if (winner) return this.retryResponse(userId, id, winner, dto.text);
      if (
        await this.events.exists({
          _id: id,
          [`chatMessages.${MAX_MESSAGES - 1}`]: { $exists: true },
        })
      ) {
        throw new ConflictException({ code: 'SOS_CHAT_MESSAGE_LIMIT_REACHED' });
      }
      throw new HttpException(
        { code: 'SOS_CHAT_RATE_LIMITED', retryAfterSeconds: 60 },
        429
      );
    }
    const saved = event.chatMessages.at(-1);
    try {
      await this.sos.getChatContext(userId, id);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        await this.events.updateOne(
          { _id: id },
          { $pull: { chatMessages: { _id: saved._id } } }
        );
      }
      throw error;
    }
    const profiles = await this.profiles([userId]);
    const result = this.messageResponse(id, saved, profiles.get(userId));
    try {
      const members = await this.sos.notifyChatMembers(id, 'sos.chat.message', {
        chatId: id,
        sosId: id,
        message: result,
      });
      this.notifications.dispatchPush(
        members.filter((memberId) => memberId !== userId),
        {
          type: 'SOS_CHAT_MESSAGE',
          chatId: id,
          sosId: id,
          messageId: saved._id.toString(),
          message: 'Có tin nhắn mới trong nhóm hỗ trợ SOS',
        },
        'Tin nhắn nhóm SOS'
      );
    } catch {
      this.logger.warn(
        `SOS_CHAT_NOTIFICATION_FAILED sos=${id} message=${saved._id}`
      );
    }
    return result;
  }

  private async findPrevious(
    id: string,
    userId: string,
    clientMessageId: string
  ) {
    const event = await this.events.findById(id).select({
      chatMessages: {
        $elemMatch: { senderId: new Types.ObjectId(userId), clientMessageId },
      },
    });
    return event?.chatMessages?.[0];
  }

  private async retryResponse(
    userId: string,
    id: string,
    message: SosChatMessage,
    text: string
  ) {
    if (message.text !== text)
      throw new ConflictException({ code: 'CHAT_CLIENT_MESSAGE_ID_REUSED' });
    if (message.expiresAt <= new Date())
      throw new ConflictException({ code: 'CHAT_MESSAGE_EXPIRED' });
    await this.sos.getChatContext(userId, id, true);
    return this.messageResponse(
      id,
      message,
      (await this.profiles([userId])).get(userId)
    );
  }

  private summary(event: SosEventDocument) {
    return {
      id: event.id,
      sosId: event.id,
      sosCode: event.code,
      title: `SOS - ${event.ownerName || 'HEROS'}`,
      ownerId: event.ownerId.toString(),
      ownerName: event.ownerName,
      ownerAvatarUrl: event.ownerAvatarUrl,
      status: ACTIVE.includes(event.status) ? 'active' : 'closed',
      sosStatus: event.status,
      memberCount: new Set([
        event.ownerId.toString(),
        ...event.recipients
          .filter((r) => r.acknowledgedAt && r.userId)
          .map((r) => r.userId.toString()),
      ]).size,
      createdAt: event.startedAt,
      closedAt: event.resolvedAt || event.cancelledAt || null,
      lastMessageSequence: event.chatSequence || 0,
    };
  }

  private async members(event: SosEventDocument) {
    const members = new Map<
      string,
      { userId: string; role: string; joinedAt: Date; supportMode?: string }
    >();
    const ownerId = event.ownerId.toString();
    members.set(ownerId, {
      userId: ownerId,
      role: 'owner',
      joinedAt: event.startedAt,
    });
    for (const recipient of event.recipients) {
      if (
        recipient.userId &&
        recipient.acknowledgedAt &&
        recipient.userId.toString() !== ownerId
      ) {
        const userId = recipient.userId.toString();
        members.set(userId, {
          userId,
          role: 'responder',
          joinedAt: recipient.acknowledgedAt,
          supportMode: recipient.supportMode,
        });
      }
    }
    const profiles = await this.profiles([...members.keys()]);
    return [...members.values()].map((member) => ({
      ...member,
      ...profiles.get(member.userId),
    }));
  }

  private async profiles(ids: string[]) {
    const profiles = new Map<string, { name: string; avatarUrl?: string }>();
    for (const id of new Set(ids)) {
      const user = await this.users.findById(id);
      profiles.set(id, {
        name:
          user?.status === 'active'
            ? user.fullName || 'Người dùng HEROS'
            : 'Tài khoản không còn hoạt động',
        avatarUrl: user?.status === 'active' ? user.avatarUrl : undefined,
      });
    }
    return profiles;
  }

  private messageResponse(
    chatId: string,
    message: SosChatMessage,
    profile?: { name: string; avatarUrl?: string }
  ) {
    return {
      id: message._id.toString(),
      chatId,
      sosId: chatId,
      clientMessageId: message.clientMessageId,
      sequence: message.sequence,
      sender: { userId: message.senderId.toString(), ...profile },
      type: 'text',
      text: message.text,
      createdAt: message.createdAt,
      expiresAt: message.expiresAt,
    };
  }
}
