import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request?.headers?.authorization;
    const bearer =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;

    if (!bearer) throw new UnauthorizedException('Missing bearer token');

    try {
      const user = await this.jwtService.verifyAsync<AuthenticatedUser>(bearer);
      if (user.type !== 'access' || !user.sub || !user.email) {
        throw new Error('Unexpected token type');
      }
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
