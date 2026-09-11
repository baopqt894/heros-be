import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EmailOtpDocument = HydratedDocument<EmailOtp>;

@Schema({
  collection: 'email_otp_challenges',
  timestamps: true,
  versionKey: false,
})
export class EmailOtp {
  @Prop({ lowercase: true, required: true, trim: true })
  email: string;

  @Prop({ enum: ['login', 'register'], required: true })
  purpose: 'login' | 'register';

  @Prop({ required: true, select: false })
  codeHash: string;

  @Prop({ default: 0, min: 0 })
  attemptCount: number;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ required: true })
  resendAvailableAt: Date;

  @Prop()
  consumedAt?: Date;
}

export const EmailOtpSchema = SchemaFactory.createForClass(EmailOtp);
EmailOtpSchema.index({ email: 1, purpose: 1 });
EmailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
