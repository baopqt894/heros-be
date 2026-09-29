import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { HardwareDevicesService } from './hardware-devices.service';

describe('HardwareDevicesService', () => {
  const ownerId = new Types.ObjectId();
  const deviceId = new Types.ObjectId();

  it('returns a one-time token and stores only its hash', async () => {
    const select = jest.fn().mockResolvedValue(null);
    const model = {
      findOne: jest.fn().mockReturnValue({ select }),
      findOneAndUpdate: jest.fn().mockResolvedValue({
        _id: deviceId,
        hardwareId: 'HEROS-TEST-001',
        label: 'Test device',
        enabled: true,
      }),
    };
    const service = new HardwareDevicesService(
      model as any,
      {
        getMe: jest.fn().mockResolvedValue({ userType: 'device_owner' }),
      } as any
    );

    const result = await service.provision(ownerId.toString(), {
      hardwareId: 'HEROS-TEST-001',
      label: 'Test device',
    });

    expect(result.deviceToken).toMatch(/^hdv_[A-Za-z0-9_-]{43}$/);
    const update = model.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.secretHash).toHaveLength(64);
    expect(update.$set.secretHash).not.toContain(result.deviceToken);
  });

  it('authenticates a valid physical-device token', async () => {
    const token = 'hdv_test-token-value';
    const secretHash = createHash('sha256').update(token).digest('hex');
    const select = jest.fn().mockResolvedValue({
      _id: deviceId,
      ownerId,
      hardwareId: 'HEROS-TEST-001',
      secretHash,
    });
    const model = {
      findOne: jest.fn().mockReturnValue({ select }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const service = new HardwareDevicesService(model as any, {} as any);

    await expect(
      service.authenticate('HEROS-TEST-001', token)
    ).resolves.toEqual({
      deviceId: deviceId.toString(),
      hardwareId: 'HEROS-TEST-001',
      ownerId: ownerId.toString(),
    });
  });

  it('rejects an invalid physical-device token', async () => {
    const secretHash = createHash('sha256').update('correct').digest('hex');
    const model = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          _id: deviceId,
          ownerId,
          hardwareId: 'HEROS-TEST-001',
          secretHash,
        }),
      }),
    };
    const service = new HardwareDevicesService(model as any, {} as any);

    await expect(
      service.authenticate('HEROS-TEST-001', 'wrong')
    ).rejects.toMatchObject({
      response: { code: 'DEVICE_CREDENTIAL_INVALID' },
    });
  });
});
