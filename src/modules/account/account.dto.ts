import { Equals, IsMongoId, Matches } from 'class-validator';

export class RequestPhoneOtpDto {
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone: string;
}
export class ConfirmAccountActionDto {
  @IsMongoId()
  challengeId: string;
  @Matches(/^\d{6}$/)
  otp: string;
}
export class DeleteAccountDto extends ConfirmAccountActionDto {
  @Equals('DELETE')
  confirmation: string;
}
