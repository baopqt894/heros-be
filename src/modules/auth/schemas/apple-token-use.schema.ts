import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'apple_token_uses', versionKey: false })
export class AppleTokenUse {
  @Prop({ required: true, unique: true }) digest: string;
  @Prop({ required: true }) expiresAt: Date;
}
export const AppleTokenUseSchema = SchemaFactory.createForClass(AppleTokenUse);
AppleTokenUseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
