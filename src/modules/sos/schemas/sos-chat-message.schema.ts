import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ _id: true, versionKey: false })
export class SosChatMessage {
  _id: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  clientMessageId: string;

  @Prop({ required: true, min: 1 })
  sequence: number;

  @Prop({ required: true, maxlength: 2000 })
  text: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop({ required: true })
  expiresAt: Date;
}

export const SosChatMessageSchema =
  SchemaFactory.createForClass(SosChatMessage);
