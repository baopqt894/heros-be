import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class WebRegisterDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @Matches(/^\d{6}$/) otp: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) fullName: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) password: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(200) deviceId: string;
}
