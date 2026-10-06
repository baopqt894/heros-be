import {
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) name: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @Matches(/^(0|\+84)[0-9]{9}$/) phone: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(500) address: string;
  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  quantity: number;
  @ApiProperty({ enum: ['payos', 'cod'] }) @IsIn(['payos', 'cod']) method:
    'payos' | 'cod';
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') requestId: string;
}
export class ClaimOrderDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  orderCode: number;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/) guestToken: string;
}
