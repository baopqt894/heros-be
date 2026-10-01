import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EmergencyContactDocument = HydratedDocument<EmergencyContact>;

@Schema({
  collection: 'emergency_contacts',
  timestamps: true,
  versionKey: false,
})
export class EmergencyContact {
  @Prop({
    index: true,
    ref: 'User',
    required: true,
    type: MongooseSchema.Types.ObjectId,
  })
  ownerId: Types.ObjectId;

  @Prop({ ref: 'User', type: MongooseSchema.Types.ObjectId })
  linkedUserId?: Types.ObjectId;

  @Prop({
    default: 'unlinked',
    enum: ['unlinked', 'pending', 'accepted', 'declined'],
    index: true,
  })
  invitationStatus: 'unlinked' | 'pending' | 'accepted' | 'declined';

  @Prop()
  invitationRespondedAt?: Date;

  @Prop({ maxlength: 120, required: true, trim: true })
  name: string;

  @Prop({ maxlength: 20, trim: true })
  phone?: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop({ maxlength: 80, trim: true })
  relationship?: string;

  @Prop({ default: 0, min: 0 })
  priority: number;

  @Prop({ default: true })
  emailEnabled: boolean;

  @Prop({ default: true })
  pushEnabled: boolean;
}

export const EmergencyContactSchema =
  SchemaFactory.createForClass(EmergencyContact);
EmergencyContactSchema.index({ ownerId: 1, priority: 1, createdAt: 1 });
EmergencyContactSchema.index({ linkedUserId: 1, invitationStatus: 1 });
