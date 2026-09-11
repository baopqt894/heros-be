import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DeviceDocument = HydratedDocument<Device>;

@Schema({ collection: 'devices', timestamps: true, versionKey: false })
export class Device {
  @Prop({
    index: true,
    ref: 'User',
    required: true,
    type: MongooseSchema.Types.ObjectId,
  })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  deviceId: string;

  @Prop({ enum: ['ios', 'android'], required: true })
  platform: 'ios' | 'android';

  @Prop({ required: true, trim: true })
  pushToken: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ required: true })
  lastSeenAt: Date;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);
DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceSchema.index({ pushToken: 1 }, { unique: true });
