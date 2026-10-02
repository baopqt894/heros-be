import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { RegistrationController } from './registration.controller';
import { PasswordService } from './password.service';
import { AppleAuthService } from './apple-auth.service';
import { AppleAuthController } from './apple-auth.controller';
import { AppleTokenUse, AppleTokenUseSchema } from './schemas/apple-token-use.schema';
import { EmailOtp, EmailOtpSchema } from './schemas/email-otp.schema';
import {
  RefreshSession,
  RefreshSessionSchema,
} from './schemas/refresh-session.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: EmailOtp.name, schema: EmailOtpSchema },
      { name: RefreshSession.name, schema: RefreshSessionSchema },
      { name: AppleTokenUse.name, schema: AppleTokenUseSchema },
    ]),
  ],
  controllers: [AuthController, RegistrationController, AppleAuthController],
  providers: [AuthService, AuthRateLimitService, EmailService, PasswordService, AppleAuthService],
  exports: [AuthService, EmailService, PasswordService],
})
export class AuthModule {}
