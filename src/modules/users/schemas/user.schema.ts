import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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

  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ default: '', trim: true })
  fullName: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  dateOfBirth?: Date;

  @Prop({ enum: ['male', 'female', 'other', 'undisclosed'] })
  gender?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ default: false })
  responderEnabled: boolean;

  @Prop({ default: 5000, max: 50000, min: 1000 })
  responderRadiusMeters: number;

  @Prop({ type: GeoPointSchema })
  lastLocation?: GeoPoint;

  @Prop({ default: 'active', enum: ['active', 'blocked'] })
  status: 'active' | 'blocked';

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ lastLocation: '2dsphere' }, { sparse: true });
