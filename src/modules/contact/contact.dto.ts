import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class CreateContactDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email: string;
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  @Matches(/^(?:(?:0|\+84)[0-9]{9})?$/)
  phone = '';
  @Transform(trim) @IsString() @MinLength(5) @MaxLength(2000) message: string;
}
