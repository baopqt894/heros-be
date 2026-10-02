import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { SosModule } from '../sos/sos.module';
import { UsersModule } from '../users/users.module';
import { EmergencyContactsModule } from '../emergency-contacts/emergency-contacts.module';
import {
  AccountChallenge,
  AccountChallengeSchema,
} from './schemas/account-challenge.schema';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    SosModule,
    EmergencyContactsModule,
    MongooseModule.forFeature([
      { name: AccountChallenge.name, schema: AccountChallengeSchema },
    ]),
  ],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
