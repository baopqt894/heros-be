import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

describe('AuthService password login', () => {
  const passwordService = new PasswordService();

  function createService(user: Record<string, any> | null) {
    const sessionModel = {
      create: jest.fn().mockResolvedValue({
        _id: { toString: () => 'session-id' },
      }),
    };
    const usersService = {
      activateSession: jest.fn().mockResolvedValue(undefined),
      findByEmailWithPassword: jest.fn().mockResolvedValue(user),
    };
    const jwtService = {
      signAsync: jest.fn().mockResolvedValue('access-token'),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_REFRESH_TTL_DAYS') return '30';
        return undefined;
      }),
    };

    return new AuthService(
      {} as never,
      sessionModel as never,
      usersService as never,
      {} as never,
      passwordService,
      jwtService as never,
      config as never
    );
  }

  it('returns a session for valid credentials without exposing passwordHash', async () => {
    const passwordHash = await passwordService.hash('Heros@Test123');
    const user = {
      _id: { toString: () => 'user-id' },
      email: 'user@example.com',
      passwordHash,
      status: 'active',
      toObject: () => ({
        _id: 'user-id',
        email: 'user@example.com',
        passwordHash,
        status: 'active',
      }),
    };

    const result = await createService(user).passwordLogin(
      'USER@example.com',
      'Heros@Test123',
      'ios-device-id'
    );

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toMatch(/^session-id\./);
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('returns the same generic error for a wrong password', async () => {
    const passwordHash = await passwordService.hash('Heros@Test123');
    const user = {
      passwordHash,
      status: 'active',
    };

    await expect(
      createService(user).passwordLogin(
        'user@example.com',
        'wrong-password',
        'ios-device-id'
      )
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CREDENTIALS' },
    });
  });

  it('returns the same generic error when the account has no password', async () => {
    await expect(
      createService(null).passwordLogin(
        'missing@example.com',
        'Heros@Test123',
        'ios-device-id'
      )
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CREDENTIALS' },
    });
  });
});
