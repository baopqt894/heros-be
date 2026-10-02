import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RefreshSessionDocument = HydratedDocument<RefreshSession>;

@Schema({ collection: 'refresh_sessions', timestamps: true, versionKey: false })
export class RefreshSession {
  @Prop({
    index: true,
    ref: 'User',
    required: true,
    type: MongooseSchema.Types.ObjectId,
  })
  userId: Types.ObjectId;

  @Prop({ required: true, select: false })
  tokenHash: string;

  @Prop({ required: true, trim: true })
  deviceId: string;

  @Prop({ required: true })
  sessionKey: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  revokedAt?: Date;
}

export const RefreshSessionSchema =
  SchemaFactory.createForClass(RefreshSession);
RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
