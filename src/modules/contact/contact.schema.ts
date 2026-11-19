import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContactMessageDocument = HydratedDocument<ContactMessage>;
@Schema({ collection: 'contact_messages', versionKey: false })
export class ContactMessage {
  @Prop({ required: true, trim: true, maxlength: 100 }) name: string;
  @Prop({ required: true, trim: true, maxlength: 254 }) email: string;
  @Prop({ default: '', maxlength: 20 }) phone: string;
  @Prop({ required: true, trim: true, maxlength: 2000 }) message: string;
  @Prop({ required: true, default: Date.now }) createdAt: Date;
}
export const ContactMessageSchema =
  SchemaFactory.createForClass(ContactMessage);
