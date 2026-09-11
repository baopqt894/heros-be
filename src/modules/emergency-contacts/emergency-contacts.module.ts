import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmergencyContactsController } from './emergency-contacts.controller';
import { EmergencyContactsService } from './emergency-contacts.service';
import {
  EmergencyContact,
  EmergencyContactSchema,
} from './schemas/emergency-contact.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmergencyContact.name, schema: EmergencyContactSchema },
    ]),
  ],
  controllers: [EmergencyContactsController],
  providers: [EmergencyContactsService],
  exports: [EmergencyContactsService],
})
export class EmergencyContactsModule {}
