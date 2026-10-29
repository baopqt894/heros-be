import { ConfigService } from '@nestjs/config';
import { JWT } from 'google-auth-library';
import { FirebaseService } from './firebase.service';

describe('FCM delivery', () => {
  const originalFetch = global.fetch;
  let access: jest.SpyInstance;
  let service: FirebaseService;
  beforeEach(() => {
    access = jest
      .spyOn(JWT.prototype, 'getAccessToken')
      .mockResolvedValue({ token: 'test-access-token' } as never);
    service = new FirebaseService(
      new ConfigService({
        FIREBASE_PROJECT_ID: 'test-project',
        FIREBASE_CLIENT_EMAIL: 'test@example.invalid',
        FIREBASE_PRIVATE_KEY: 'test-key',
      })
    );
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses visible high-priority alerts and separates resolved/audio notification groups', async () => {
    const requests: any[] = [];
    global.fetch = jest.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body as string).message);
      expect(init.signal).toBeTruthy();
      return new Response('{}', { status: 200 });
    }) as any;
    const safe = {
      type: 'SOS_RESOLVED',
      sosId: 'test-sos',
      message: 'Owner is safe',
    };
    expect(
      await service.send(
        ['private-device-token', 'private-device-token'],
        safe,
        'Safe'
      )
    ).toEqual({ sent: 1, failed: 0, disabled: false });
    await service.send(['private-device-token'], {
      ...safe,
      type: 'SOS_RECORDING_AVAILABLE',
      message: 'New audio',
    });
    expect(requests).toHaveLength(2);
    expect(requests[0].notification).toEqual({
      title: 'Safe',
      body: 'Owner is safe',
    });
    expect(requests[0].apns.headers).toMatchObject({
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    expect(requests[0].android.priority).toBe('high');
    expect(requests[0].android.notification.tag).not.toBe(
      requests[1].android.notification.tag
    );
    expect(requests[0].apns.headers['apns-collapse-id']).not.toBe(
      requests[1].apns.headers['apns-collapse-id']
    );
  });

  it('retries a temporary provider error once', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(
      (
        await service.send(['device-token'], {
          type: 'SOS_RESOLVED',
          message: 'Safe',
        })
      ).sent
    ).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry invalid devices and logs only a sanitized provider reason', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'sensitive upstream text',
            details: [{ errorCode: 'UNREGISTERED' }],
          },
        }),
        { status: 404 }
      )
    );
    expect(
      await service.send(['private-device-token'], {
        type: 'SOS_RESOLVED',
        message: 'Safe',
      })
    ).toEqual({ sent: 0, failed: 1, disabled: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((service as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('FCM_HTTP_404_UNREGISTERED')
    );
    const logs = JSON.stringify((service as any).logger.warn.mock.calls);
    expect(logs).not.toContain('private-device-token');
    expect(logs).not.toContain('sensitive upstream text');
  });

  it.each([429, 503])(
    'does not shorten a long provider backoff on HTTP %s',
    async (status) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          new Response('{}', { status, headers: { 'Retry-After': '60' } })
        );
      expect(
        (await service.send(['device-token'], { type: 'SOS_RESOLVED' })).failed
      ).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    }
  );

  it('bounds network retries and handles absent configuration without sending', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    expect(
      (await service.send(['device-token'], { type: 'SOS_RESOLVED' })).failed
    ).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const disabled = new FirebaseService(new ConfigService({}));
    expect(await disabled.send(['device-token'], {})).toEqual({
      sent: 0,
      failed: 0,
      disabled: true,
    });
    expect(access).toHaveBeenCalledTimes(1);
  });
});
