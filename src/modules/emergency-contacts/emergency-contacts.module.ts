import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
import {
  EmergencyContact,
  EmergencyContactSchema,
} from './schemas/emergency-contact.schema';
import { UsersModule } from '../users/users.module';
import { ContactInvitesController } from './contact-invites.controller';
import { ContactInvitesService } from './contact-invites.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { AppLinksController } from './app-links.controller';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: EmergencyContact.name, schema: EmergencyContactSchema },
    ]),
  ],
  controllers: [
    EmergencyContactsController,
    ContactInvitesController,
    AppLinksController,
  ],
  providers: [
    EmergencyContactsService,
    ContactInvitesService,
    AuthRateLimitService,
  ],
  exports: [EmergencyContactsService],
})
export class EmergencyContactsModule {}
