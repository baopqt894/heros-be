import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { AppleAuthService } from './apple-auth.service';

describe('Apple identity verification', () => {
  const jwt = new JwtService();
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const nonce = 'n'.repeat(32);
  const originalFetch = global.fetch;
  const user = { status: 'active' };
  let service: AppleAuthService;
  let users: any;
  let auth: any;
  let used: any;
  beforeEach(() => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'test' }],
        }),
      });
    users = { findOne: jest.fn().mockResolvedValue(user) };
    auth = {
      createSession: jest.fn().mockResolvedValue({ accessToken: 'session' }),
    };
    used = { create: jest.fn().mockResolvedValue({}) };
    service = new AppleAuthService(
      new ConfigService({ APPLE_CLIENT_IDS: 'vn.heros.ios' }),
      jwt,
      users,
      auth,
      used
    );
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  function token(extra = {}) {
    return jwt.sign(
      {
        sub: 'apple-sub',
        nonce: createHash('sha256').update(nonce).digest('hex'),
        email: 'verified@example.com',
        email_verified: true,
        ...extra,
      },
      {
        secret: keys.privateKey
          .export({ type: 'pkcs8', format: 'pem' })
          .toString(),
        algorithm: 'RS256',
        keyid: 'test',
        issuer: 'https://appleid.apple.com',
        audience: 'vn.heros.ios',
        expiresIn: '5m',
      }
    );
  }
  it('verifies the signed token before issuing a session', async () => {
    await expect(
      service.login({
        identityToken: token(),
        rawNonce: nonce,
        deviceId: 'installation',
      })
    ).resolves.toEqual({ accessToken: 'session' });
    expect(users.findOne).toHaveBeenCalledWith({ appleSubject: 'apple-sub' });
    expect(used.create).toHaveBeenCalled();
  });
  it.each([
    { sub: 'fake', appleId: 'wrong' },
    { rawNonce: 'wrong' },
    { email: 'other@example.com' },
  ])('rejects client identity mismatch %j', async (overrides) => {
    await expect(
      service.login({
        identityToken: token(),
        rawNonce: nonce,
        deviceId: 'installation',
        ...overrides,
      })
    ).rejects.toMatchObject({ response: { code: 'APPLE_TOKEN_INVALID' } });
    expect(auth.createSession).not.toHaveBeenCalled();
  });
  it('rejects the wrong audience', async () => {
    service = new AppleAuthService(
      new ConfigService({ APPLE_CLIENT_IDS: 'another.app' }),
      jwt,
      users,
      auth,
      used
    );
    await expect(
      service.login({
        identityToken: token(),
        rawNonce: nonce,
        deviceId: 'installation',
      })
    ).rejects.toMatchObject({ response: { code: 'APPLE_TOKEN_INVALID' } });
  });
  it('rejects a replayed identity token', async () => {
    used.create.mockRejectedValue({ code: 11000 });
    await expect(
      service.login({
        identityToken: token(),
        rawNonce: nonce,
        deviceId: 'installation',
      })
    ).rejects.toMatchObject({ response: { code: 'APPLE_TOKEN_INVALID' } });
  });
});
