import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

  it('revokes an accepted contact immediately for detail, incoming list and playback', async () => {
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

  it('queues account deletion, revokes mobile and hardware access, then removes all owned data', async () => {
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
  });
});
