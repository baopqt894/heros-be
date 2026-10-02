import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongoSchema } from 'mongoose';

export type AccountChallengeDocument = HydratedDocument<AccountChallenge>;

@Schema({ collection: 'account_challenges', timestamps: true })
export class AccountChallenge {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  userId: Types.ObjectId;
  @Prop({ enum: ['phone_update', 'account_delete'], required: true })
  purpose: string;
  @Prop({ required: true })
  target: string;
  @Prop({ required: true, select: false })
  codeHash: string;
  @Prop({ default: 0 })
  attempts: number;
  @Prop({ required: true })
  expiresAt: Date;
  @Prop({ required: true })
  resendAt: Date;
  @Prop()
  consumedAt?: Date;
}
export const AccountChallengeSchema =
  SchemaFactory.createForClass(AccountChallenge);
AccountChallengeSchema.index({ userId: 1, purpose: 1 }, { unique: true });
AccountChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
