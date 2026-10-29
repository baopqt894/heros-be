import { NotificationsService } from './notifications.service';

describe('Push observability', () => {
  it('reports missing eligible registrations rather than silently succeeding', async () => {
    const devices = { findPushTokens: jest.fn().mockResolvedValue([]) };
    const firebase = {
      send: jest
        .fn()
        .mockResolvedValue({ sent: 0, failed: 0, disabled: false }),
    };
    const service = new NotificationsService(
      devices as any,
      firebase as any,
      {} as any
    );
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});
    await (service as any).performPush(
      ['user-id'],
      { type: 'SOS_RESOLVED' },
      'Safe'
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('users=1 tokens=0 sent=0 failed=0 disabled=false')
    );
    expect(devices.findPushTokens).toHaveBeenCalledWith(['user-id']);
    warn.mockRestore();
  });
});
