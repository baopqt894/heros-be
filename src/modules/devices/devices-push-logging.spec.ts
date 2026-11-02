import { Logger } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { diagnosticFingerprint } from '../../common/utils/diagnostic-fingerprint';

describe('Push token registration diagnostics', () => {
  const dto = {
    deviceId: 'private-installation-id',
    platform: 'ios' as const,
    pushToken: 'private-new-fcm-token-value',
  };
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { previous: null, state: 'new', updated: true },
    {
      previous: { pushToken: 'old-token', sessionKey: 'old-session' },
      state: 'changed',
      updated: true,
    },
    {
      previous: { pushToken: dto.pushToken, sessionKey: 'new-session' },
      state: 'unchanged',
      updated: false,
    },
    {
      previous: { pushToken: dto.pushToken, sessionKey: 'old-session' },
      state: 'unchanged',
      updated: true,
    },
  ])(
    'logs $state tokens and session refresh independently',
    async ({ previous, state, updated }) => {
      const stored = { enabled: true };
      const model = {
        findOne: jest
          .fn()
          .mockReturnValue({
            select: jest
              .fn()
              .mockReturnValue({ lean: jest.fn().mockResolvedValue(previous) }),
          }),
        findOneAndUpdate: jest.fn().mockResolvedValue(stored),
      };
      const service = new DevicesService(model as any);
      expect(
        await service.register('507f1f77bcf86cd799439011', dto, 'new-session')
      ).toBe(stored);
      const update = model.findOneAndUpdate.mock.calls[0][1].$set;
      expect(update.pushToken).toBe(dto.pushToken);
      expect(update.sessionKey).toBe('new-session');
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(`tokenState=${state} sessionUpdated=${updated}`)
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          `tokenFingerprint=${diagnosticFingerprint(dto.pushToken)}`
        )
      );
      const output = JSON.stringify(log.mock.calls);
      for (const secret of [
        dto.pushToken,
        dto.deviceId,
        'new-session',
        'old-session',
      ])
        expect(output).not.toContain(secret);
    }
  );

  it('logs database failure without printing the error or credential', async () => {
    const failure = new Error(`failed with ${dto.pushToken}`);
    const model = {
      findOne: jest
        .fn()
        .mockReturnValue({
          select: jest
            .fn()
            .mockReturnValue({ lean: jest.fn().mockRejectedValue(failure) }),
        }),
    };
    await expect(
      new DevicesService(model as any).register(
        '507f1f77bcf86cd799439011',
        dto,
        'private-session'
      )
    ).rejects.toBe(failure);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('PUSH_TOKEN_REGISTER_FAILED')
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(dto.pushToken);
  });

  it('logs installation mismatch before rejecting without storing anything', async () => {
    const service = { register: jest.fn() };
    const controller = new DevicesController(service as any);
    await expect(
      controller.register(
        {
          sub: 'user-id',
          deviceId: 'different-installation',
          sessionKey: 'private-session',
        } as any,
        dto
      )
    ).rejects.toMatchObject({ response: { code: 'SESSION_DEVICE_MISMATCH' } });
    expect(service.register).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('PUSH_TOKEN_REGISTER_REJECTED')
    );
    expect(
      JSON.stringify([...log.mock.calls, ...warn.mock.calls])
    ).not.toContain(dto.pushToken);
  });
});
