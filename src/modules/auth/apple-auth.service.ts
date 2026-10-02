import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, createPublicKey, JsonWebKey } from 'node:crypto';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AuthService } from './auth.service';
import { AppleLoginDto } from './dto/apple.dto';
import { AppleTokenUse } from './schemas/apple-token-use.schema';

@Injectable()
export class AppleAuthService {
  private keys: Array<JsonWebKey & { kid: string; alg?: string }> = [];
  private fetchedAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly auth: AuthService,
    @InjectModel(AppleTokenUse.name)
    private readonly tokenUses: Model<AppleTokenUse>
  ) {}

  async login(dto: AppleLoginDto) {
    const claims = await this.verify(dto);
    let user = await this.users.findOne({ appleSubject: claims.sub });
    if (!user) {
      if (!claims.email || !['true', true].includes(claims.email_verified))
        throw new BadRequestException({
          code: 'APPLE_VERIFIED_EMAIL_REQUIRED',
        });
      if (!dto.userType)
        throw new BadRequestException({ code: 'USER_TYPE_REQUIRED' });
      if (await this.users.exists({ email: claims.email.toLowerCase() }))
        throw new ConflictException({ code: 'APPLE_ACCOUNT_LINK_REQUIRED' });
      try {
        user = await this.users.create({
          appleSubject: claims.sub,
          email: claims.email.toLowerCase(),
          emailVerifiedAt: new Date(),
          fullName: dto.name || '',
          userType: dto.userType,
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        user = await this.users.findOne({ appleSubject: claims.sub });
        if (!user)
          throw new ConflictException({ code: 'APPLE_ACCOUNT_LINK_REQUIRED' });
      }
    }
    if (user.status !== 'active')
      throw new UnauthorizedException('Account is unavailable');
    return this.auth.createSession(user, dto.deviceId);
  }

  async link(userId: string, dto: AppleLoginDto) {
    const claims = await this.verify(dto);
    try {
      const result = await this.users.updateOne(
        {
          _id: userId,
          status: 'active',
          $or: [
            { appleSubject: { $exists: false } },
            { appleSubject: claims.sub },
          ],
        },
        { $set: { appleSubject: claims.sub } }
      );
      if (!result.matchedCount)
        throw new ConflictException({ code: 'APPLE_ALREADY_LINKED' });
    } catch (error) {
      if (error.code === 11000)
        throw new ConflictException({ code: 'APPLE_ALREADY_LINKED' });
      throw error;
    }
    return { linked: true };
  }

  private async verify(dto: AppleLoginDto) {
    const audiences = (this.config.get<string>('APPLE_CLIENT_IDS') || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!audiences.length)
      throw new ServiceUnavailableException({
        code: 'APPLE_LOGIN_NOT_CONFIGURED',
      });
    try {
      const decoded = this.jwt.decode(dto.identityToken, {
        complete: true,
      }) as any;
      if (!decoded?.header?.kid || decoded.header.alg !== 'RS256')
        throw new Error('Invalid algorithm');
      if (Date.now() - this.fetchedAt > 60 * 60_000) {
        const response = await fetch('https://appleid.apple.com/auth/keys', {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Key fetch failed');
        this.keys = (
          (await response.json()) as { keys: typeof this.keys }
        ).keys;
        this.fetchedAt = Date.now();
      }
      const key = this.keys.find(
        (key) => key.kid === decoded.header.kid && key.kty === 'RSA'
      );
      if (!key) throw new Error('Unknown key');
      const claims = await this.jwt.verifyAsync<any>(dto.identityToken, {
        secret: createPublicKey({ key, format: 'jwk' })
          .export({ type: 'spki', format: 'pem' })
          .toString(),
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: audiences as [string, ...string[]],
      });
      if (
        !claims.sub ||
        !claims.exp ||
        !claims.iat ||
        Date.now() / 1000 - claims.iat > 600 ||
        claims.iat > Date.now() / 1000 + 60
      )
        throw new Error('Invalid claims');
      if (
        claims.nonce !== createHash('sha256').update(dto.rawNonce).digest('hex')
      )
        throw new Error('Nonce mismatch');
      if (dto.appleId && dto.appleId !== claims.sub)
        throw new Error('Subject mismatch');
      if (dto.email && dto.email.toLowerCase() !== claims.email?.toLowerCase())
        throw new Error('Email mismatch');
      await this.tokenUses.create({
        digest: createHash('sha256').update(dto.identityToken).digest('hex'),
        expiresAt: new Date(claims.exp * 1000),
      });
      return claims;
    } catch {
      throw new UnauthorizedException({ code: 'APPLE_TOKEN_INVALID' });
    }
  }
}
