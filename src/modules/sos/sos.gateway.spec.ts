import { SosGateway } from './sos.gateway';

describe('Realtime session revocation', () => {
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
