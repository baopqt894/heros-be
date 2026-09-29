import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type HardwareDeviceDocument = HydratedDocument<HardwareDevice>;

@Schema({ collection: 'hardware_devices', timestamps: true, versionKey: false })
export class HardwareDevice {
  @Prop({
    index: true,
    ref: 'User',
    required: true,
    type: MongooseSchema.Types.ObjectId,
  })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true, unique: true })
  hardwareId: string;

  @Prop({ maxlength: 120, trim: true })
  label?: string;

  @Prop({ required: true, select: false })
  secretHash: string;

  @Prop({ default: true })
  enabled: boolean;

  @Prop()
  lastSeenAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const HardwareDeviceSchema =
  SchemaFactory.createForClass(HardwareDevice);
HardwareDeviceSchema.index({ ownerId: 1, createdAt: -1 });
