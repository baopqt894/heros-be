import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SosEventDocument = HydratedDocument<SosEvent>;

@Schema({ _id: false })
class SosLocation {
  @Prop({ enum: ['Point'], required: true })
  type: 'Point';

  @Prop({ required: true, type: [Number] })
  coordinates: [number, number];

  @Prop({ min: 0, required: true })
  accuracy: number;

  @Prop({ required: true })
  recordedAt: Date;
}

const SosLocationSchema = SchemaFactory.createForClass(SosLocation);

@Schema({ _id: false })
class SosRecipient {
  @Prop({ enum: ['emergency_contact', 'nearby_responder'], required: true })
  type: string;

  @Prop({ ref: 'User', type: MongooseSchema.Types.ObjectId })
  userId?: Types.ObjectId;

  @Prop()
  name?: string;

  @Prop()
  email?: string;

  @Prop()
  phone?: string;

  @Prop({ default: [], type: [String] })
  channels: string[];

  @Prop()
  acknowledgedAt?: Date;
}

const SosRecipientSchema = SchemaFactory.createForClass(SosRecipient);

@Schema({ collection: 'sos_events', timestamps: true, versionKey: false })
export class SosEvent {
  @Prop({
    index: true,
    ref: 'User',
    required: true,
    type: MongooseSchema.Types.ObjectId,
  })
  ownerId: Types.ObjectId;

  @Prop({ index: true, required: true, unique: true })
  code: string;

  @Prop({ required: true })
  clientRequestId: string;

  @Prop({
    default: 'active',
    enum: ['active', 'acknowledged', 'resolved', 'cancelled'],
  })
  status: string;

  @Prop({ maxlength: 500, required: true })
  message: string;

  @Prop({ required: true, type: SosLocationSchema })
  initialLocation: SosLocation;

  @Prop({ required: true, type: SosLocationSchema })
  currentLocation: SosLocation;

  @Prop({ default: [], type: [SosRecipientSchema] })
  recipients: SosRecipient[];

  @Prop({
    default: 'not_opened',
    enum: ['not_opened', 'composer_opened', 'user_reported_sent'],
  })
  smsStatus: string;

  @Prop({ required: true })
  startedAt: Date;

  @Prop()
  resolvedAt?: Date;

  @Prop()
  cancelledAt?: Date;

  @Prop({ maxlength: 200 })
  cancelReason?: string;
}

export const SosEventSchema = SchemaFactory.createForClass(SosEvent);
SosEventSchema.index({ ownerId: 1, clientRequestId: 1 }, { unique: true });
SosEventSchema.index({ ownerId: 1, status: 1, startedAt: -1 });
SosEventSchema.index({ currentLocation: '2dsphere' });
