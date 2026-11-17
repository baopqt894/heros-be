import { NotificationsService } from './notifications.service';

describe('Push observability', () => {
  it('dispatches SOS_CREATED to all eligible tokens and logs the result', async () => {
    const devices = {
      findPushTokens: jest.fn().mockResolvedValue(['token-a', 'token-b']),
    };
    const firebase = {
      send: jest
        .fn()
        .mockResolvedValue({ sent: 1, failed: 1, disabled: false }),
    };
    const service = new NotificationsService(
      devices as any,
      firebase as any,
      {} as any
    );
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});
    await (service as any).performDispatch({
      eventId: 'test-sos',
      code: 'TEST',
      ownerName: 'Owner',
      message: 'Test',
      mapUrl: '',
      pushUserIds: ['a', 'b', 'a'],
      emails: [],
    });
    expect(devices.findPushTokens).toHaveBeenCalledWith(['a', 'b']);
    expect(firebase.send).toHaveBeenCalledWith(
      ['token-a', 'token-b'],
      expect.objectContaining({ type: 'SOS_CREATED', sosId: 'test-sos' }),
      expect.any(String)
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'type=SOS_CREATED sosId=test-sos users=2 tokens=2 sent=1 failed=1'
      )
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('token-a');
    warn.mockRestore();
  });

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
