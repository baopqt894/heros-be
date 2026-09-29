import { DeviceSosController } from './device-sos.controller';

describe('DeviceSosController', () => {
  it('verifies device credentials without creating an SOS', async () => {
    const hardwareDevices = {
      authenticate: jest.fn().mockResolvedValue({
        deviceId: 'device-id',
        hardwareId: 'HEROS-TEST-001',
        ownerId: 'owner-id',
      }),
    };
    const sosService = { create: jest.fn() };
    const controller = new DeviceSosController(
      hardwareDevices as any,
      sosService as any
    );

    const result = await controller.ping('HEROS-TEST-001', 'device-token');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      connected: true,
      hardwareId: 'HEROS-TEST-001',
    });
    expect(result.data.serverTime).toBeTruthy();
    expect(sosService.create).not.toHaveBeenCalled();
  });

  it('creates the SOS for the owner authenticated by the hardware credential', async () => {
    const hardwareDevices = {
      authenticate: jest.fn().mockResolvedValue({
        deviceId: 'device-id',
        hardwareId: 'HEROS-TEST-001',
        ownerId: 'owner-id',
      }),
    };
    const sosService = {
      create: jest.fn().mockResolvedValue({ id: 'sos-id', status: 'active' }),
    };
    const controller = new DeviceSosController(
      hardwareDevices as any,
      sosService as any
    );
    const dto = {
      clientRequestId: '125fe329-0bfd-428f-a69f-a9cefe22449e',
      message: 'SOS test from device',
      location: {
        latitude: 10.762622,
        longitude: 106.660172,
        accuracy: 10,
        recordedAt: new Date().toISOString(),
      },
    };

    await expect(
      controller.create('heros-test-001', 'device-token', dto)
    ).resolves.toEqual({
      success: true,
      data: { id: 'sos-id', status: 'active' },
    });
    expect(hardwareDevices.authenticate).toHaveBeenCalledWith(
      'heros-test-001',
      'device-token'
    );
    expect(sosService.create).toHaveBeenCalledWith('owner-id', dto);
  });
});
