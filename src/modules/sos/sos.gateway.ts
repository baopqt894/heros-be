import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UsersService } from '../users/users.service';

@Injectable()
@WebSocketGateway({
  namespace: '/sos',
  cors: { origin: true, credentials: true },
  perMessageDeflate: false,
  httpCompression: false,
  pingInterval: 20000,
  pingTimeout: 20000,
})
export class SosGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly users: UsersService
  ) {}

  async handleConnection(@ConnectedSocket() socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    try {
      const user = await this.jwtService.verifyAsync<AuthenticatedUser>(token);
      if (user.type !== 'access' || !user.sub) {
        throw new Error('Unexpected token type');
      }
      await this.users.assertSession(user.sub, user.sessionKey);
      socket.data.user = user;
      await socket.join(`user:${user.sub}`);
      socket.emit('sos.ready', { userId: user.sub });
    } catch {
      socket.disconnect(true);
    }
  }

  async notifyUser(userId: string, event: string, payload: unknown) {
    if (!this.server) return;
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    const checks = new Map<string, Promise<void>>();
    await Promise.all(
      sockets.map(async (socket) => {
        try {
          const user = socket.data.user as AuthenticatedUser;
          if (
            !user?.sessionKey ||
            (user.exp !== undefined && user.exp * 1000 <= Date.now())
          )
            throw new Error('Expired');
          let check = checks.get(user.sessionKey);
          if (!check) {
            check = this.users.assertSession(userId, user.sessionKey);
            checks.set(user.sessionKey, check);
          }
          await check;
          socket.emit(event, payload);
        } catch {
          socket.disconnect(true);
        }
      })
    );
  }
}
