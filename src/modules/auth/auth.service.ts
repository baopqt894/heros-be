import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { Model, Types } from 'mongoose';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import { EmailService } from './email.service';
import { RegisterUserDto } from './dto/register-user.dto';
import { PasswordService } from './password.service';
import { EmailOtp, EmailOtpDocument } from './schemas/email-otp.schema';
import {
  RefreshSession,
  RefreshSessionDocument,
} from './schemas/refresh-session.schema';

@Injectable()
export class AuthService {
  private readonly oauthClient = new OAuth2Client();
  private readonly otpTtlMinutes: number;
  private readonly refreshTtlDays: number;

  constructor(
    @InjectModel(EmailOtp.name)
    private readonly otpModel: Model<EmailOtpDocument>,
    @InjectModel(RefreshSession.name)
    private readonly sessionModel: Model<RefreshSessionDocument>,
    private readonly usersService: UsersService,
    private readonly emailService: EmailService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService
  ) {
    this.otpTtlMinutes = Number(config.get('OTP_TTL_MINUTES') || 5);
    this.refreshTtlDays = Number(config.get('JWT_REFRESH_TTL_DAYS') || 30);
  }

  async requestEmailOtp(
    rawEmail: string,
    purpose: 'login' | 'register' = 'login'
  ) {
    const email = this.usersService.normalizeEmail(rawEmail);
    const existingUser = await this.usersService.findByEmail(email);
    if (purpose === 'register' && existingUser) {
      throw new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED' });
    }
    if (purpose === 'login' && !existingUser) {
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND' });
    }
    const now = new Date();
    const current = await this.otpModel
      .findOne({ email, purpose, consumedAt: { $exists: false } })
      .sort({ createdAt: -1 })
      .exec();
    if (current && current.resendAvailableAt > now) {
      throw new HttpException(
        {
          code: 'OTP_RESEND_TOO_SOON',
          retryAfterSeconds: Math.ceil(
            (current.resendAvailableAt.getTime() - now.getTime()) / 1000
          ),
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(now.getTime() + this.otpTtlMinutes * 60_000);
    const challenge = await this.otpModel.create({
      email,
      purpose,
      codeHash: this.hashOtp(email, code),
      expiresAt,
      resendAvailableAt: new Date(now.getTime() + 60_000),
    });
    try {
      await this.emailService.sendOtp(email, code, this.otpTtlMinutes);
    } catch (error) {
      await this.otpModel.deleteOne({ _id: challenge._id });
      throw error;
    }
    return { expiresAt, purpose, resendAfterSeconds: 60 };
  }

  async verifyEmailOtp(rawEmail: string, code: string, deviceId: string) {
    const email = this.usersService.normalizeEmail(rawEmail);
    await this.consumeOtp(email, code, 'login');
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException({ code: 'USER_NOT_FOUND' });
    if (user.status !== 'active')
      throw new UnauthorizedException('Account is unavailable');
    return this.createSession(user, deviceId);
  }

  async register(dto: RegisterUserDto) {
    const email = this.usersService.normalizeEmail(dto.email);
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      throw new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED' });
    }
    await this.consumeOtp(email, dto.otp, 'register');

    const passwordHash = dto.password
      ? await this.passwordService.hash(dto.password)
      : undefined;
    let user: UserDocument;
    try {
      user = await this.usersService.createEmailUser(email, {
        fullName: dto.fullName,
        dateOfBirth: dto.dateOfBirth,
        gender: dto.gender,
        phone: dto.phone,
        passwordHash,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException({ code: 'EMAIL_ALREADY_REGISTERED' });
      }
      throw error;
    }
    return this.createSession(user, dto.deviceId);
  }

  async passwordLogin(email: string, password: string, deviceId: string) {
    const user = await this.usersService.findByEmailWithPassword(email);
    const isValid = await this.passwordService.verify(
      password,
      user?.passwordHash
    );
    if (!user || !isValid || user.status !== 'active') {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    return this.createSession(user, deviceId);
  }

  async resetPassword(
    rawEmail: string,
    otp: string,
    newPassword: string,
    deviceId: string
  ) {
    const email = this.usersService.normalizeEmail(rawEmail);
    await this.consumeOtp(email, otp, 'login');
    const user = await this.usersService.findByEmail(email);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND' });
    }
    const passwordHash = await this.passwordService.hash(newPassword);
    const updatedUser = await this.usersService.setPassword(
      user._id.toString(),
      passwordHash
    );
    return this.createSession(updatedUser, deviceId);
  }

  private async consumeOtp(
    email: string,
    code: string,
    purpose: 'login' | 'register'
  ) {
    const challenge = await this.otpModel
      .findOne({
        email,
        purpose,
        consumedAt: { $exists: false },
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .select('+codeHash')
      .exec();

    if (!challenge || challenge.attemptCount >= 5) throw this.invalidOtp();
    const actual = Buffer.from(challenge.codeHash, 'hex');
    const expected = Buffer.from(this.hashOtp(email, code), 'hex');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      challenge.attemptCount += 1;
      await challenge.save();
      throw this.invalidOtp();
    }

    const consumed = await this.otpModel.updateOne(
      { _id: challenge._id, consumedAt: { $exists: false } },
      { $set: { consumedAt: new Date() } }
    );
    if (!consumed.modifiedCount) throw this.invalidOtp();
  }

  async googleLogin(idToken: string, deviceId: string) {
    const audiences = (this.config.get<string>('GOOGLE_CLIENT_IDS') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!audiences.length) {
      throw new UnauthorizedException({ code: 'GOOGLE_LOGIN_NOT_CONFIGURED' });
    }

    let payload;
    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken,
        audience: audiences,
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException({ code: 'GOOGLE_ID_TOKEN_INVALID' });
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new UnauthorizedException({ code: 'GOOGLE_IDENTITY_INVALID' });
    }

    const email = this.usersService.normalizeEmail(payload.email);
    let user = await this.usersService.findByGoogleSubject(payload.sub);
    if (!user) {
      user = await this.usersService.findByEmail(email);
      if (user?.googleSubject && user.googleSubject !== payload.sub) {
        throw new ConflictException({ code: 'GOOGLE_IDENTITY_CONFLICT' });
      }
      if (!user) user = await this.usersService.createEmailUser(email);
      user.googleSubject = payload.sub;
      if (!user.fullName && payload.name) user.fullName = payload.name;
      if (!user.avatarUrl && payload.picture) user.avatarUrl = payload.picture;
      await user.save();
    }
    if (user.status !== 'active')
      throw new UnauthorizedException('Account is unavailable');
    return this.createSession(user, deviceId);
  }

  async refresh(rawToken: string, deviceId?: string) {
    const [sessionId, secret] = rawToken.split('.');
    if (!Types.ObjectId.isValid(sessionId) || !secret)
      throw this.invalidRefresh();
    const session = await this.sessionModel
      .findById(sessionId)
      .select('+tokenHash')
      .exec();
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw this.invalidRefresh();
    if (deviceId && session.deviceId !== deviceId) throw this.invalidRefresh();
    if (!this.safeEqual(session.tokenHash, this.hashToken(secret)))
      throw this.invalidRefresh();

    session.revokedAt = new Date();
    await session.save();
    const user = await this.usersService.findById(session.userId.toString());
    if (!user || user.status !== 'active') throw this.invalidRefresh();
    return this.createSession(user, session.deviceId);
  }

  async logout(rawToken: string) {
    const [sessionId] = rawToken.split('.');
    if (Types.ObjectId.isValid(sessionId)) {
      await this.sessionModel.updateOne(
        { _id: sessionId, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date() } }
      );
    }
    return { loggedOut: true };
  }

  private async createSession(user: UserDocument, deviceId: string) {
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 86_400_000);
    const session = await this.sessionModel.create({
      userId: user._id,
      tokenHash: this.hashToken(secret),
      deviceId,
      expiresAt,
    });
    const accessToken = await this.jwtService.signAsync({
      sub: user._id.toString(),
      email: user.email,
      type: 'access',
    });
    const safeUser = user.toObject();
    delete (safeUser as { passwordHash?: string }).passwordHash;
    return {
      accessToken,
      refreshToken: `${session._id.toString()}.${secret}`,
      refreshExpiresAt: expiresAt,
      user: safeUser,
    };
  }

  private hashOtp(email: string, code: string) {
    const secret = this.config.get<string>('OTP_HASH_SECRET');
    if (!secret) throw new Error('OTP_HASH_SECRET is required');
    return createHmac('sha256', secret)
      .update(`${email}:${code}`)
      .digest('hex');
  }

  private hashToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private invalidOtp() {
    return new UnauthorizedException({ code: 'OTP_INVALID_OR_EXPIRED' });
  }

  private invalidRefresh() {
    return new UnauthorizedException({ code: 'REFRESH_TOKEN_INVALID' });
  }
}
