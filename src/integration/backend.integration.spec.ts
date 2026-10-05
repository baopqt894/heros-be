import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { io, Socket } from 'socket.io-client';
import { AuthService } from '../modules/auth/auth.service';
import { EmailService } from '../modules/auth/email.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { FirebaseService } from '../modules/notifications/firebase.service';
import { AccountService } from '../modules/account/account.service';
import { AvatarUploadService } from '../modules/account/avatar-upload.service';
import { DevicesService } from '../modules/devices/devices.service';
import { SosService } from '../modules/sos/sos.service';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { ApiResponseInterceptor } from '../common/interceptors/api-response.interceptor';

jest.setTimeout(180_000);

describe('Backend contracts against isolated MongoDB', () => {
  let mongo: MongoMemoryServer;
  let app: any;
  let directory: string;
  let base: string;
  let owner: any;
  let contact: any;
  let outsider: any;
  let ownerToken: string;
  let contactToken: string;
  let outsiderToken: string;
  let hardware: Record<string, string>;
  let eventId: string;
  let contactId: string;
  let recordingId: string;
  const sendOtp = jest.fn().mockResolvedValue(undefined);
  const previousEnv = { ...process.env };
  const sockets: Socket[] = [];
  const received: Record<string, any[]> = {
    owner: [],
    contact: [],
    outsider: [],
  };
  let firstChatMessage: any;

  async function connectChat(label: string, token: string) {
    const socket = io(`${base.replace(/\/v1$/, '')}/sos`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });
    sockets.push(socket);
    socket.onAny((name, payload) => received[label].push({ name, payload }));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket readiness timed out')),
        5000
      );
      socket.once('sos.ready', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.connect();
    });
    return socket;
  }

  async function chatFixture(recipients: any[] = []) {
    return app.get(getModelToken('SosEvent')).create({
      ownerId: owner._id,
      ownerName: 'Owner',
      code: `TEST-${randomUUID()}`,
      clientRequestId: randomUUID(),
      message: 'Isolated chat fixture',
      initialLocation: {
        type: 'Point',
        coordinates: [106, 10],
        accuracy: 5,
        recordedAt: new Date(),
      },
      currentLocation: {
        type: 'Point',
        coordinates: [106, 10],
        accuracy: 5,
        recordedAt: new Date(),
      },
      recipients,
      startedAt: new Date(),
    });
  }

  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    token = ownerToken,
    headers: Record<string, string> = {}
  ) {
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !(body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...headers,
      },
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    const data = response.headers
      .get('content-type')
      ?.includes('application/json')
      ? await response.json()
      : await response.arrayBuffer();
    return { status: response.status, body: data as any };
  }
  function clip(clientRecordingId = '36c77012-8bbf-4b4b-932f-32c6b738b169') {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([Buffer.from('RIFF0000WAVEtest')], { type: 'audio/wav' }),
      'clip.wav'
    );
    form.append('durationSeconds', '1');
    form.append('clientRecordingId', clientRecordingId);
    return form;
  }

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    directory = await mkdtemp(join(tmpdir(), 'heros-integration-'));
    Object.assign(process.env, {
      NODE_ENV: 'test',
      MONGODB_URI: mongo.getUri('heros_test'),
      JWT_ACCESS_SECRET: 'j'.repeat(64),
      OTP_HASH_SECRET: 'o'.repeat(64),
      EMAIL_DEV_LOG_OTP: 'false',
      SMTP_HOST: '',
      FIREBASE_PROJECT_ID: '',
      FIREBASE_CLIENT_EMAIL: '',
      FIREBASE_PRIVATE_KEY: '',
      SOS_RECORDINGS_DIR: directory,
    });
    const { AppModule } = await import('../app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ sendOtp, sendSos: jest.fn() })
      .overrideProvider(FirebaseService)
      .useValue({ send: jest.fn() })
      .overrideProvider(AvatarUploadService)
      .useValue({
        upload: jest
          .fn()
          .mockResolvedValue(
            'https://storages.limgrow.com/uploads/test/avatar.png'
          ),
      })
      .overrideProvider(NotificationsService)
      .useValue({ dispatchSos: jest.fn(), dispatchPush: jest.fn() })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/v1`;
    const connection = app.get(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model: any) => model.init())
    );
    const users = app.get(getModelToken('User'));
    owner = await users.create({
      email: 'owner@test.invalid',
      emailVerifiedAt: new Date(),
      fullName: 'Owner',
      userType: 'device_owner',
    });
    contact = await users.create({
      email: 'contact@test.invalid',
      emailVerifiedAt: new Date(),
      fullName: 'Contact',
      userType: 'emergency_contact',
    });
    outsider = await users.create({
      email: 'outside@test.invalid',
      emailVerifiedAt: new Date(),
      fullName: 'Outside',
      userType: 'emergency_contact',
    });
    const auth = app.get(AuthService);
    ownerToken = (await auth.createSession(owner, 'owner-phone')).accessToken;
    contactToken = (await auth.createSession(contact, 'contact-phone'))
      .accessToken;
    outsiderToken = (await auth.createSession(outsider, 'outside-phone'))
      .accessToken;
  });
  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    if (app) await app.close();
    if (mongo) await mongo.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
    process.env = previousEnv;
  });

  it('revokes old HTTP tokens and excludes old push registrations', async () => {
    expect(
      (
        await request('/me/devices', 'POST', {
          deviceId: 'owner-phone',
          platform: 'ios',
          pushToken: 'old-push-token-for-test',
        })
      ).status
    ).toBe(201);
    const oldToken = ownerToken;
    ownerToken = (await app.get(AuthService).createSession(owner, 'new-phone'))
      .accessToken;
    expect((await request('/me', 'GET', undefined, oldToken)).status).toBe(401);
    expect((await request('/me', 'GET')).status).toBe(200);
    expect(await app.get(DevicesService).findPushTokens([owner.id])).toEqual(
      []
    );
  });

  it('generates a one-time email code bound to the requested phone, without claiming SMS verification', async () => {
    const challenge = await request('/me/phone/request-otp', 'POST', {
      phone: '+84901234567',
    });
    expect(challenge.status).toBe(201);
    expect(challenge.body.data.deliveryChannel).toBe('email');
    const otp = sendOtp.mock.calls.at(-1)[1];
    expect(otp).toMatch(/^\d{6}$/);
    const payload = { challengeId: challenge.body.data.challengeId, otp };
    const verified = await request('/me/phone/verify-otp', 'POST', payload);
    expect(verified.body.data.phoneOwnershipVerified).toBe(false);
    expect(verified.body.data.phone).toBe('+84901234567');
    expect(
      (await request('/me/phone/verify-otp', 'POST', payload)).status
    ).toBe(401);
    expect(
      (await request('/me', 'PATCH', { phone: '+84909999999' })).status
    ).toBe(400);
  });

  it('stores only the uploaded URL and protects the legacy profile route', async () => {
    const form = new FormData();
    form.append(
      'avatar',
      new Blob([Buffer.from('89504e470d0a1a0a00000000', 'hex')], {
        type: 'image/png',
      }),
      'avatar.png'
    );
    const uploaded = await request('/me/avatar', 'POST', form);
    expect(uploaded.body.data.avatarUrl).toBe(
      'https://storages.limgrow.com/uploads/test/avatar.png'
    );
    const user = await app
      .get(getModelToken('User'))
      .findById(owner.id)
      .select('+avatarData');
    expect(user.avatarUrl).toBe(uploaded.body.data.avatarUrl);
    expect(user.avatarData).toBeUndefined();
    expect((await request(`/profiles/${owner.id}/avatar`)).status).toBe(302);
    expect(
      (
        await request(
          `/profiles/${owner.id}/avatar`,
          'GET',
          undefined,
          outsiderToken
        )
      ).status
    ).toBe(403);
  });

  it('limits email OTP guesses and does not consume a code for a different action', async () => {
    const challenge = await request(
      '/me/phone/request-otp',
      'POST',
      { phone: '+84902222222' },
      outsiderToken
    );
    const otp = sendOtp.mock.calls.at(-1)[1];
    const payload = { challengeId: challenge.body.data.challengeId, otp };
    expect(
      (
        await request(
          '/me',
          'DELETE',
          { ...payload, confirmation: 'DELETE' },
          outsiderToken
        )
      ).status
    ).toBe(401);
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await request(
            '/me/phone/verify-otp',
            'POST',
            { ...payload, otp: otp === '000000' ? '000001' : '000000' },
            outsiderToken
          )
        ).status
      ).toBe(401);
    }
    expect(
      (await request('/me/phone/verify-otp', 'POST', payload, outsiderToken))
        .status
    ).toBe(401);
  });

  it('uploads device clips idempotently and ignores out-of-order GPS', async () => {
    const link = await app.get(getModelToken('EmergencyContact')).create({
      ownerId: owner._id,
      linkedUserId: contact._id,
      invitationStatus: 'accepted',
      name: 'Contact',
      phone: '+84901111111',
    });
    contactId = link.id;
    const provision = await request('/me/heros-devices', 'POST', {
      hardwareId: 'HEROS-INTEGRATION-001',
    });
    expect(provision.status).toBe(201);
    hardware = {
      'X-Heros-Hardware-Id': 'HEROS-INTEGRATION-001',
      'X-Heros-Device-Token': provision.body.data.deviceToken,
    };
    const created = await request(
      '/device/sos',
      'POST',
      {
        clientRequestId: randomUUID(),
        message: 'Integration test only',
        location: {
          latitude: 10,
          longitude: 106,
          accuracy: 5,
          recordedAt: new Date(Date.now() - 10_000).toISOString(),
        },
      },
      '',
      hardware
    );
    expect(created.status).toBe(201);
    eventId = created.body.data.id;
    const fix = {
      latitude: 11,
      longitude: 107,
      accuracy: 4,
      recordedAt: new Date().toISOString(),
    };
    const updated = await request(
      `/device/sos/${eventId}/location`,
      'PUT',
      fix,
      '',
      hardware
    );
    expect(updated.body.data.currentLocation.coordinates).toEqual([107, 11]);
    const stale = await request(
      `/device/sos/${eventId}/location`,
      'PUT',
      {
        ...fix,
        latitude: 12,
        recordedAt: new Date(Date.now() - 5000).toISOString(),
      },
      '',
      hardware
    );
    expect(stale.body.data.currentLocation.coordinates).toEqual([107, 11]);
    expect(
      (
        await request(
          `/device/sos/${eventId}/recordings`,
          'POST',
          clip(),
          '',
          {}
        )
      ).status
    ).toBe(401);
    const [first, retry] = await Promise.all([
      request(
        `/device/sos/${eventId}/recordings`,
        'POST',
        clip(),
        '',
        hardware
      ),
      request(
        `/device/sos/${eventId}/recordings`,
        'POST',
        clip(),
        '',
        hardware
      ),
    ]);
    expect(first.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    recordingId = first.body.data.id;
    expect(await readdir(directory)).toHaveLength(1);
  });

  it('adds only acknowledged responders to the shared chat, with GPS and recordings', async () => {
    await connectChat('owner', ownerToken);
    await connectChat('contact', contactToken);
    await connectChat('outsider', outsiderToken);
    const ownerRoom = await request(`/sos-chats/${eventId}`);
    expect(ownerRoom.status).toBe(200);
    expect(ownerRoom.body.data.members.map((m) => m.userId)).toEqual([
      owner.id,
    ]);
    expect(
      (await request(`/sos-chats/${eventId}`, 'GET', undefined, contactToken))
        .status
    ).toBe(403);
    expect(
      (
        await request(
          `/sos-chats/${eventId}/messages`,
          'POST',
          { clientMessageId: randomUUID(), text: 'Not accepted yet' },
          contactToken
        )
      ).status
    ).toBe(403);
    expect(
      (await request('/sos-chats', 'GET', undefined, contactToken)).body.data
        .items
    ).toEqual([]);
    const accepted = await request(
      `/sos/${eventId}/acknowledge`,
      'POST',
      { supportMode: 'remote' },
      contactToken
    );
    expect(accepted.body.data.chatId).toBe(eventId);
    const room = await request(
      `/sos-chats/${eventId}`,
      'GET',
      undefined,
      contactToken
    );
    expect(room.body.data.members).toHaveLength(2);
    expect(
      room.body.data.members.find((m) => m.userId === contact.id).supportMode
    ).toBe('remote');
    expect(room.body.data.currentLocation.coordinates).toEqual([107, 11]);
    expect(room.body.data.recordings[0].id).toBe(recordingId);
    expect(JSON.stringify(room.body.data)).not.toContain(
      'contact@test.invalid'
    );
    expect(
      (await request('/sos-chats', 'GET', undefined, contactToken)).body.data
        .items[0].id
    ).toBe(eventId);
    expect(
      (await request(`/sos-chats/${eventId}`, 'GET', undefined, outsiderToken))
        .status
    ).toBe(404);
  });

  it('atomically deduplicates concurrent sends and delivers chat only to members', async () => {
    const payload = {
      clientMessageId: randomUUID(),
      text: '  Tôi đang đến, bạn đang ở đâu?  ',
    };
    const [first, retry] = await Promise.all([
      request(`/sos-chats/${eventId}/messages`, 'POST', payload, contactToken),
      request(`/sos-chats/${eventId}/messages`, 'POST', payload, contactToken),
    ]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(first.body.data.id).toBe(retry.body.data.id);
    firstChatMessage = first.body.data;
    expect(firstChatMessage.sequence).toBe(1);
    expect(firstChatMessage.text).toBe(payload.text.trim());
    expect(firstChatMessage.sender.userId).toBe(contact.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const member of ['owner', 'contact']) {
      expect(
        received[member].filter(
          (e) =>
            e.name === 'sos.chat.message' &&
            e.payload.message.id === firstChatMessage.id
        )
      ).toHaveLength(1);
    }
    expect(
      received.outsider.filter((e) => e.name === 'sos.chat.message')
    ).toHaveLength(0);
    expect(
      (
        await request(
          `/sos-chats/${eventId}/messages`,
          'POST',
          { ...payload, text: 'Changed text' },
          contactToken
        )
      ).status
    ).toBe(409);
    for (const body of [
      { text: ' ' },
      { text: 'x'.repeat(2001) },
      { text: 'x', senderId: owner.id },
    ]) {
      expect(
        (
          await request(
            `/sos-chats/${eventId}/messages`,
            'POST',
            { clientMessageId: randomUUID(), ...body },
            contactToken
          )
        ).status
      ).toBe(400);
    }
    const pushCalls = app.get(NotificationsService).dispatchPush.mock.calls;
    const chatPush = pushCalls.find(
      (call) => call[1].type === 'SOS_CHAT_MESSAGE'
    );
    expect(chatPush[0]).toEqual([owner.id]);
    expect(chatPush[1].message).not.toContain(firstChatMessage.text);
  });

  it('paginates and catches up with committed monotonic sequences, treating text as literal', async () => {
    const replies = await Promise.all(
      ['$ownerId', 'Tin thứ ba', 'Tin thứ tư'].map((text) =>
        request(`/sos-chats/${eventId}/messages`, 'POST', {
          clientMessageId: randomUUID(),
          text,
        })
      )
    );
    expect(replies.every((r) => r.status === 201)).toBe(true);
    expect(replies.map((r) => r.body.data.sequence).sort()).toEqual([2, 3, 4]);
    expect(replies[0].body.data.text).toBe('$ownerId');
    const latest = await request(
      `/sos-chats/${eventId}/messages?limit=2`,
      'GET',
      undefined,
      contactToken
    );
    expect(latest.body.data.items.map((m) => m.sequence)).toEqual([3, 4]);
    expect(latest.body.data.nextBeforeSequence).toBe(3);
    const older = await request(
      `/sos-chats/${eventId}/messages?beforeSequence=3&limit=2`
    );
    expect(older.body.data.items.map((m) => m.sequence)).toEqual([1, 2]);
    const catchup = await request(
      `/sos-chats/${eventId}/messages?afterSequence=1&limit=2`
    );
    expect(catchup.body.data.items.map((m) => m.sequence)).toEqual([2, 3]);
    expect(catchup.body.data.nextAfterSequence).toBe(3);
    expect(catchup.body.data.lastSequence).toBe(4);
    expect(
      (
        await request(
          `/sos-chats/${eventId}/messages?beforeSequence=3&afterSequence=1`
        )
      ).status
    ).toBe(400);
    expect(
      (await request(`/sos-chats/${eventId}/messages?limit=101`)).status
    ).toBe(400);
    expect((await request('/sos-chats/not-an-id')).status).toBe(404);
    const genericSos = await request(`/sos/${eventId}`);
    expect(genericSos.body.data).not.toHaveProperty('chatMessages');
  });

  it('delivers hardware GPS and recording updates to both owner and chat responders', async () => {
    const recordedAt = new Date().toISOString();
    expect(
      (
        await request(
          `/device/sos/${eventId}/location`,
          'PUT',
          { latitude: 12, longitude: 108, accuracy: 3, recordedAt },
          '',
          hardware
        )
      ).status
    ).toBe(200);
    const upload = await request(
      `/device/sos/${eventId}/recordings`,
      'POST',
      clip(randomUUID()),
      '',
      hardware
    );
    expect(upload.status).toBe(201);
    const id = upload.body.data.id;
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const label of ['owner', 'contact']) {
      expect(
        received[label].some(
          (e) =>
            e.name === 'sos.location' &&
            e.payload.location.recordedAt === recordedAt
        )
      ).toBe(true);
      expect(
        received[label].some(
          (e) => e.name === 'sos.recording' && e.payload.recording.id === id
        )
      ).toBe(true);
    }
    expect(
      received.outsider.some(
        (e) => e.name === 'sos.location' || e.name === 'sos.recording'
      )
    ).toBe(false);
    expect(
      (await request(`/sos/${eventId}/recordings/${id}`, 'DELETE')).status
    ).toBe(200);
  });

  it('revokes an accepted contact immediately for detail, incoming list, chat and playback', async () => {
    expect(
      (await request(`/sos/${eventId}/acknowledge`, 'POST', {}, contactToken))
        .status
    ).toBe(201);
    expect(
      (
        await request(
          `/sos/${eventId}/recordings/${recordingId}`,
          'GET',
          undefined,
          contactToken
        )
      ).status
    ).toBe(200);
    expect(
      (await request(`/emergency-contacts/${contactId}`, 'DELETE')).status
    ).toBe(200);
    for (const suffix of ['', '/messages']) {
      expect(
        (
          await request(
            `/sos-chats/${eventId}${suffix}`,
            'GET',
            undefined,
            contactToken
          )
        ).status
      ).toBe(403);
    }
    expect(
      (
        await request(
          `/sos-chats/${eventId}/messages`,
          'POST',
          { clientMessageId: randomUUID(), text: 'Revoked sender' },
          contactToken
        )
      ).status
    ).toBe(403);
    expect(
      (await request('/sos-chats', 'GET', undefined, contactToken)).body.data
        .items
    ).toEqual([]);
    const before = received.contact.filter(
      (e) => e.name === 'sos.chat.message'
    ).length;
    expect(
      (
        await request(`/sos-chats/${eventId}/messages`, 'POST', {
          clientMessageId: randomUUID(),
          text: 'Owner only now',
        })
      ).status
    ).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      received.contact.filter((e) => e.name === 'sos.chat.message')
    ).toHaveLength(before);
    expect(
      (await request(`/sos/${eventId}`, 'GET', undefined, contactToken)).status
    ).toBe(403);
    expect(
      (await request('/sos/incoming/active', 'GET', undefined, contactToken))
        .body.data
    ).toEqual([]);
    expect(
      (
        await request(
          `/sos/${eventId}/recordings/${recordingId}`,
          'GET',
          undefined,
          contactToken
        )
      ).status
    ).toBe(403);
  });

  it('keeps deletion metadata on IO failure and retries without deleting another clip', async () => {
    const uploaded = await request(
      `/device/sos/${eventId}/recordings`,
      'POST',
      clip(randomUUID()),
      '',
      hardware
    );
    const id = uploaded.body.data.id;
    const model = app.get(getModelToken('SosEvent'));
    const event = await model.findById(eventId);
    const record = event.recordings.find((r) => r.id === id);
    const path = join(directory, record.storageKey);
    const saved = join(directory, 'saved-audio');
    await rename(path, saved);
    await mkdir(path);
    expect(
      (await request(`/sos/${eventId}/recordings/${id}`, 'DELETE')).status
    ).toBe(500);
    expect((await model.findById(eventId)).recordings).toHaveLength(2);
    expect(
      (await request(`/sos/${eventId}/recordings/${id}`, 'GET')).status
    ).toBe(404);
    await rm(path, { recursive: true });
    await rename(saved, path);
    await (app.get(SosService) as any).cleanupExpiredRecordings();
    const remaining = await model.findById(eventId);
    expect(remaining.recordings).toHaveLength(1);
    expect(remaining.recordings[0].id).toBe(recordingId);
    expect(remaining.recordingBytes).toBe(remaining.recordings[0].sizeBytes);
  });

  it('enforces per-sender limits and expiration without resetting chat sequences', async () => {
    const event = await chatFixture();
    const model = app.get(getModelToken('SosEvent'));
    const seed = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        _id: new Types.ObjectId(),
        senderId: owner._id,
        clientMessageId: randomUUID(),
        sequence: i + 1,
        text: 'Fixture',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      }));
    const thirty = seed(30);
    await model.updateOne(
      { _id: event.id },
      { $set: { chatMessages: thirty, chatSequence: 30 } }
    );
    expect(
      (
        await request(`/sos-chats/${event.id}/messages`, 'POST', {
          clientMessageId: randomUUID(),
          text: 'Too fast',
        })
      ).status
    ).toBe(429);
    expect(
      (
        await request(`/sos-chats/${event.id}/messages`, 'POST', {
          clientMessageId: thirty[0].clientMessageId,
          text: 'Fixture',
        })
      ).status
    ).toBe(201);
    await model.updateOne(
      { _id: event.id },
      { $set: { chatMessages: seed(1000), chatSequence: 1000 } }
    );
    expect(
      (
        await request(`/sos-chats/${event.id}/messages`, 'POST', {
          clientMessageId: randomUUID(),
          text: 'Full',
        })
      ).body.data.errorCode
    ).toBe('SOS_CHAT_MESSAGE_LIMIT_REACHED');
    await model.updateOne(
      { _id: event.id },
      { $set: { 'chatMessages.$[].expiresAt': new Date(Date.now() - 1000) } }
    );
    expect(
      (await request(`/sos-chats/${event.id}/messages`)).body.data.items
    ).toEqual([]);
    await (app.get(SosService) as any).cleanupExpiredRecordings();
    const newMessage = await request(
      `/sos-chats/${event.id}/messages`,
      'POST',
      { clientMessageId: randomUUID(), text: 'After expiration' }
    );
    expect(newMessage.body.data.sequence).toBe(1001);
  });

  it('puts multiple accepted responders and the owner in the same group', async () => {
    const links = [];
    for (const user of [contact, outsider]) {
      const link = await app.get(getModelToken('EmergencyContact')).create({
        ownerId: owner._id,
        linkedUserId: user._id,
        invitationStatus: 'accepted',
        name: user.fullName,
        email: user.email,
      });
      links.push({
        type: 'emergency_contact',
        contactId: link._id,
        userId: user._id,
        channels: ['push'],
      });
    }
    const event = await chatFixture(links);
    for (const token of [contactToken, outsiderToken]) {
      const accepted = await request(
        `/sos/${event.id}/acknowledge`,
        'POST',
        {},
        token
      );
      expect(accepted.body.data.chatId).toBe(event.id);
    }
    const room = await request(
      `/sos-chats/${event.id}`,
      'GET',
      undefined,
      outsiderToken
    );
    expect(room.body.data.memberCount).toBe(3);
    expect(room.body.data.members.map((m) => m.userId).sort()).toEqual(
      [owner.id, contact.id, outsider.id].sort()
    );
    const message = await request(
      `/sos-chats/${event.id}/messages`,
      'POST',
      { clientMessageId: randomUUID(), text: 'Cùng hỗ trợ nhé' },
      contactToken
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const label of ['owner', 'contact', 'outsider']) {
      expect(
        received[label].some(
          (e) =>
            e.name === 'sos.chat.message' &&
            e.payload.message.id === message.body.data.id
        )
      ).toBe(true);
    }
    await request(`/sos/${event.id}/resolve`, 'POST', {});
  });

  it.each(['resolve', 'cancel'])(
    'closes the group on %s and retains owner-only history',
    async (action) => {
      const link = await app.get(getModelToken('EmergencyContact')).create({
        ownerId: owner._id,
        linkedUserId: contact._id,
        invitationStatus: 'accepted',
        name: 'Re-linked contact',
        email: contact.email,
      });
      const event = await chatFixture([
        {
          type: 'emergency_contact',
          contactId: link._id,
          userId: contact._id,
          acknowledgedAt: new Date(),
          channels: ['push'],
        },
      ]);
      expect(
        (await request(`/sos-chats/${eventId}`, 'GET', undefined, contactToken))
          .status
      ).toBe(403);
      const message = await request(
        `/sos-chats/${event.id}/messages`,
        'POST',
        { clientMessageId: randomUUID(), text: 'Help is here' },
        contactToken
      );
      expect(message.status).toBe(201);
      expect(
        (await request(`/sos/${event.id}/${action}`, 'POST', {})).status
      ).toBe(201);
      const room = await request(`/sos-chats/${event.id}`);
      expect(room.body.data.status).toBe('closed');
      expect(room.body.data.canSend).toBe(false);
      expect(
        (await request(`/sos-chats/${event.id}/messages`)).body.data.items
      ).toHaveLength(1);
      expect(
        (
          await request(
            `/sos-chats/${event.id}/messages`,
            'GET',
            undefined,
            contactToken
          )
        ).status
      ).toBe(403);
      expect(
        (
          await request(`/sos-chats/${event.id}/messages`, 'POST', {
            clientMessageId: randomUUID(),
            text: 'Too late',
          })
        ).status
      ).toBe(409);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        received.contact.some(
          (e) => e.name === 'sos.chat.closed' && e.payload.chatId === event.id
        )
      ).toBe(true);
      expect(
        (await request('/sos-chats?status=closed')).body.data.items.some(
          (r) => r.id === event.id
        )
      ).toBe(true);
      expect(
        (
          await request(
            '/sos-chats?status=closed',
            'GET',
            undefined,
            contactToken
          )
        ).body.data.items
      ).toEqual([]);
    }
  );

  it('queues account deletion, revokes mobile and hardware access, then removes all owned data', async () => {
    const foreign = await chatFixture();
    await app.get(getModelToken('SosEvent')).updateOne(
      { _id: foreign.id },
      {
        $set: {
          ownerId: outsider._id,
          chatMessages: [
            {
              _id: new Types.ObjectId(),
              senderId: owner._id,
              clientMessageId: randomUUID(),
              sequence: 1,
              text: 'Delete my text',
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 60000),
            },
            {
              _id: new Types.ObjectId(),
              senderId: outsider._id,
              clientMessageId: randomUUID(),
              sequence: 2,
              text: 'Keep other text',
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 60000),
            },
          ],
          chatSequence: 2,
        },
      }
    );
    const sos = app.get(SosService);
    const originalDelete = sos.deleteOwnedData.bind(sos);
    const deleteSpy = jest
      .spyOn(sos, 'deleteOwnedData')
      .mockRejectedValueOnce(new Error('Temporary disk failure'));
    const challenge = await request('/me/deletion/request-otp', 'POST');
    const otp = sendOtp.mock.calls.at(-1)[1];
    const deleted = await request('/me', 'DELETE', {
      challengeId: challenge.body.data.challengeId,
      otp,
      confirmation: 'DELETE',
    });
    expect(deleted.status).toBe(202);
    expect((await request('/me')).status).toBe(401);
    expect(
      (await request('/device/sos/active', 'GET', undefined, '', hardware))
        .status
    ).toBe(401);
    await app.get(AccountService).processDeletions();
    expect(
      (await app.get(getModelToken('User')).findById(owner.id)).status
    ).toBe('deleting');
    deleteSpy.mockImplementation(originalDelete);
    await app.get(AccountService).processDeletions();
    expect(await app.get(getModelToken('User')).findById(owner.id)).toBeNull();
    expect(
      await app
        .get(getModelToken('SosEvent'))
        .countDocuments({ ownerId: owner._id })
    ).toBe(0);
    expect(await readdir(directory)).toEqual([]);
    const foreignAfter = await app
      .get(getModelToken('SosEvent'))
      .findById(foreign.id)
      .select('+chatMessages');
    expect(foreignAfter.chatMessages.map((m) => m.text)).toEqual([
      'Keep other text',
    ]);
  });
});
