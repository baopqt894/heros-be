import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export const ORDER_STATUSES = [
  'CREATING',
  'PENDING',
  'UNDERPAID',
  'PROCESSING',
  'PAID',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
  'COD_CONFIRMED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
@Schema({ collection: 'commerce_orders', versionKey: false })
export class CommerceOrder {
  @Prop({ required: true, unique: true }) orderCode: number;
  @Prop({ required: true, unique: true }) requestId: string;
  @Prop({ required: true }) fingerprint: string;
  @Prop({ required: true, select: false }) accessHash: string;
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  })
  accountId: Types.ObjectId | null;
  @Prop({ required: true }) quantity: number;
  @Prop({ required: true }) amount: number;
  @Prop({ enum: ['payos', 'cod'], required: true }) method: 'payos' | 'cod';
  @Prop({ enum: ORDER_STATUSES, required: true }) status: OrderStatus;
  @Prop({
    type: { name: String, email: String, phone: String, address: String },
    required: true,
    _id: false,
  })
  customer: { name: string; email: string; phone: string; address: string };
  @Prop({ default: null }) paymentLinkId: string | null;
  @Prop({ default: null }) checkoutUrl: string | null;
  @Prop({ required: true }) createdAt: Date;
  @Prop({ default: 0 }) lastChecked: number;
  @Prop({ default: null }) paidAt: Date | null;
}
export type CommerceOrderDocument = HydratedDocument<CommerceOrder>;
export const CommerceOrderSchema = SchemaFactory.createForClass(CommerceOrder);
CommerceOrderSchema.index({ accountId: 1, orderCode: -1 });
