import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { AuthGuard } from './auth.guard';

function createContext(headers: Record<string, string> = {}) {
  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as any;
}

describe('AuthGuard', () => {
  it('allows public requests', async () => {
    const guard = new AuthGuard(
      {
        getAllAndOverride: jest.fn().mockReturnValue(true),
      } as unknown as Reflector,
      {} as JwtService,
      {} as any
    );

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
  });

  it('allows requests with a valid bearer token', async () => {
    const guard = new AuthGuard(
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector,
      {
        verifyAsync: jest.fn().mockResolvedValue({
          sub: 'user-id',
          email: 'a@b.com',
          type: 'access',
        }),
      } as unknown as JwtService,
      { assertSession: jest.fn().mockResolvedValue(undefined) } as any
    );

    await expect(
      guard.canActivate(
        createContext({
          authorization: 'Bearer test-token',
        })
      )
    ).resolves.toBe(true);
  });

  it('rejects requests with an invalid bearer token', async () => {
    const guard = new AuthGuard(
      {
        getAllAndOverride: jest.fn().mockReturnValue(false),
      } as unknown as Reflector,
      {
        verifyAsync: jest.fn().mockRejectedValue(new Error('invalid')),
      } as unknown as JwtService,
      { assertSession: jest.fn().mockResolvedValue(undefined) } as any
    );

    await expect(
      guard.canActivate(
        createContext({
          authorization: 'Bearer wrong-token',
        })
      )
    ).rejects.toThrow(UnauthorizedException);
  });
});
