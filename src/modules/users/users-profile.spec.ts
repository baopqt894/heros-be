import { Types } from 'mongoose';
import { UsersService } from './users.service';

describe('Preassigned hardware in profile', () => {
  function fixture(device: Record<string, unknown> | null) {
    const id = new Types.ObjectId();
    const user = {
      _id: id,
      status: 'active',
      toObject: () => ({
        _id: id,
        email: 'buyer@test.invalid',
        userType: 'device_owner',
      }),
    };
    const select = jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(device) });
    const hardware = { findOne: jest.fn().mockReturnValue({ select }) };
    const users = {
      findById: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(user) }),
    };
    return {
      service: new UsersService(users as any, hardware as any),
      id,
      hardware,
      select,
    };
  }

  it('returns explicit null when no active hardware is assigned', async () => {
    const { service, id, hardware } = fixture(null);
    expect((await service.getProfile(id.toString())).device).toBeNull();
    expect(hardware.findOne).toHaveBeenCalledWith({
      ownerId: id,
      enabled: true,
      activationPending: { $ne: true },
    });
  });

  it('returns safe device identity and nullable telemetry, never a token or hash', async () => {
    const deviceId = new Types.ObjectId();
    const { service, id, select } = fixture({
      _id: deviceId,
      hardwareId: 'HEROS-TEST',
      enabled: true,
      batteryPercent: 0,
      isCharging: false,
      secretHash: 'private-hash',
      deviceToken: 'private-token',
    });
    const result = await service.getProfile(id.toString());
    expect(result.device).toEqual({
      id: deviceId.toString(),
      hardwareId: 'HEROS-TEST',
      enabled: true,
      label: null,
      batteryPercent: 0,
      isCharging: false,
      estimatedMinutesRemaining: null,
      batteryReportedAt: null,
      lastSeenAt: null,
    });
    expect(select.mock.calls[0][0]).not.toContain('secretHash');
    expect(JSON.stringify(result)).not.toContain('private-');
  });
});
