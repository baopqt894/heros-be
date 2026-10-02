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
    } catch {
      socket.disconnect(true);
    }
  }

  async notifyUser(userId: string, event: string, payload: unknown) {
    if (!this.server) return;
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    for (const socket of sockets) {
      try {
        const user = socket.data.user as AuthenticatedUser;
        if (!user?.exp || user.exp * 1000 <= Date.now())
          throw new Error('Expired');
        await this.users.assertSession(userId, user.sessionKey);
        socket.emit(event, payload);
      } catch {
        socket.disconnect(true);
      }
    }
  }
}
