import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { RegistrationController } from './registration.controller';
import { PasswordService } from './password.service';
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
    ]),
  ],
  controllers: [AuthController, RegistrationController],
  providers: [AuthService, AuthRateLimitService, EmailService, PasswordService],
  exports: [AuthService, EmailService],
})
export class AuthModule {}
