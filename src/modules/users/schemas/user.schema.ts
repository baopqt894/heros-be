import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserType } from '../user-type';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
export class GeoPoint {
  @Prop({ enum: ['Point'], required: true })
  type: 'Point';

  @Prop({ required: true, type: [Number] })
  coordinates: [number, number];

  @Prop({ min: 0, required: true })
  accuracy: number;

  @Prop({ required: true })
  recordedAt: Date;
}

const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

@Schema({ collection: 'users', timestamps: true, versionKey: false })
export class User {
  @Prop({ lowercase: true, required: true, trim: true, unique: true })
  email: string;

  @Prop({ required: true })
  emailVerifiedAt: Date;

  @Prop({ index: true, sparse: true, unique: true })
  googleSubject?: string;

  @Prop({ sparse: true, unique: true })
  appleSubject?: string;

  @Prop({ select: false })
  activeSessionKey?: string;

  @Prop()
  phoneVerifiedAt?: Date;

  @Prop()
  phoneUpdateAuthorizedAt?: Date;

  @Prop({ enum: ['email_otp'] })
  phoneUpdateAuthorizationMethod?: string;

  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ default: '', trim: true })
  fullName: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ type: Buffer, select: false })
  avatarData?: Buffer;

  @Prop()
  avatarMimeType?: string;

  @Prop()
  deletionRequestedAt?: Date;

  @Prop()
  dateOfBirth?: Date;

  @Prop({ enum: ['male', 'female', 'other', 'undisclosed'] })
  gender?: string;

  @Prop({ index: true, sparse: true, trim: true, unique: true })
  phone?: string;

  @Prop({
    default: 'device_owner',
    enum: ['device_owner', 'emergency_contact', 'community_responder'],
    index: true,
    required: true,
  })
  userType: UserType;

  @Prop({ default: false })
  responderEnabled: boolean;

  @Prop({ default: 5000, max: 50000, min: 1000 })
  responderRadiusMeters: number;

  @Prop({ type: GeoPointSchema })
  lastLocation?: GeoPoint;

  @Prop({ default: 'active', enum: ['active', 'blocked', 'deleting'] })
  status: 'active' | 'blocked' | 'deleting';

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ lastLocation: '2dsphere' }, { sparse: true });
