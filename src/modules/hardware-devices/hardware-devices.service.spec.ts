import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { HardwareDevicesService } from './hardware-devices.service';

describe('HardwareDevicesService', () => {
  const ownerId = new Types.ObjectId();
  const deviceId = new Types.ObjectId();

  it('blocks legacy provisioning without changing the factory token', async () => {
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

    await expect(service.provision(ownerId.toString(), {
      hardwareId: 'HEROS-TEST-001', label: 'Test device',
    })).rejects.toMatchObject({ response: { code: 'HARDWARE_SELF_PROVISIONING_DISABLED' } });
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
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
    const service = new HardwareDevicesService(model as any, { findById: jest.fn().mockResolvedValue({ status: 'active' }) } as any);

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

  it('stores battery telemetry reported by an authenticated device', async () => {
    const reportedAt = new Date();
    const model = {
      findByIdAndUpdate: jest.fn().mockResolvedValue({
        hardwareId: 'HEROS-TEST-001',
        batteryPercent: 82,
        isCharging: false,
        estimatedMinutesRemaining: 2880,
        batteryReportedAt: reportedAt,
      }),
    };
    const service = new HardwareDevicesService(model as any, {} as any);

    await expect(
      service.updateStatus(deviceId.toString(), {
        batteryPercent: 82,
        isCharging: false,
        estimatedMinutesRemaining: 2880,
      })
    ).resolves.toMatchObject({
      batteryPercent: 82,
      isCharging: false,
      estimatedMinutesRemaining: 2880,
    });
  });
});
