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

@Injectable()
@WebSocketGateway({
  namespace: '/sos',
  cors: { origin: true, credentials: true },
})
export class SosGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(@ConnectedSocket() socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    try {
      const user = await this.jwtService.verifyAsync<AuthenticatedUser>(token);
      if (user.type !== 'access' || !user.sub) {
        throw new Error('Unexpected token type');
      }
      await socket.join(`user:${user.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  notifyUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
