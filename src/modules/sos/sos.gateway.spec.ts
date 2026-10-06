import { SosGateway } from './sos.gateway';

describe('Realtime session revocation', () => {
  it('delivers permanent JWTs and validates one time per session for multiple sockets', async () => {
    const users = { assertSession: jest.fn().mockResolvedValue(undefined) };
    const sockets = Array.from({ length: 4 }, () => ({
      data: { user: { sessionKey: 'current' } },
      emit: jest.fn(),
      disconnect: jest.fn(),
    }));
    const gateway = new SosGateway({} as any, users as any);
    gateway.server = {
      in: jest.fn().mockReturnValue({ fetchSockets: async () => sockets }),
    } as any;
    await gateway.notifyUser('id', 'sos.location', {});
    expect(users.assertSession).toHaveBeenCalledTimes(1);
    sockets.forEach((socket) =>
      expect(socket.emit).toHaveBeenCalledWith('sos.location', {})
    );
  });

  it('still rejects an expired legacy JWT', async () => {
    const users = { assertSession: jest.fn() };
    const socket = {
      data: { user: { sessionKey: 'current', exp: 1 } },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    const gateway = new SosGateway({} as any, users as any);
    gateway.server = {
      in: jest.fn().mockReturnValue({ fetchSockets: async () => [socket] }),
    } as any;
    await gateway.notifyUser('id', 'sos.location', {});
    expect(users.assertSession).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
  it('disconnects a revoked socket instead of delivering GPS', async () => {
    const users = {
      assertSession: jest.fn().mockRejectedValue(new Error('revoked')),
    };
    const socket = {
      data: { user: { sessionKey: 'old', exp: Date.now() / 1000 + 100 } },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    const gateway = new SosGateway({} as any, users as any);
    gateway.server = {
      in: jest.fn().mockReturnValue({ fetchSockets: async () => [socket] }),
    } as any;
    await gateway.notifyUser('id', 'sos.location', {});
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
