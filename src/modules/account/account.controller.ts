import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AccountService } from './account.service';
import {
  ConfirmAccountActionDto,
  DeleteAccountDto,
  RequestPhoneOtpDto,
} from './account.dto';

@ApiTags('account')
@ApiBearerAuth('bearer-token')
@Controller()
export class AccountController {
  constructor(private readonly accounts: AccountService) {}
  @Post('me/phone/request-otp')
  async requestPhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestPhoneOtpDto
  ) {
    return {
      success: true,
      data: await this.accounts.requestOtp(user.sub, 'phone_update', dto.phone),
    };
  }
  @Post('me/phone/verify-otp')
  async verifyPhone(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmAccountActionDto
  ) {
    return {
      success: true,
      data: await this.accounts.updatePhone(user.sub, dto),
    };
  }
  @Post('me/deletion/request-otp')
  async requestDelete(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.accounts.requestOtp(user.sub, 'account_delete'),
    };
  }
  @Delete('me')
  @HttpCode(202)
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DeleteAccountDto
  ) {
    return {
      success: true,
      data: await this.accounts.requestDeletion(user.sub, dto),
    };
  }
  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
    })
  )
  async uploadAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number }
  ) {
    return {
      success: true,
      data: await this.accounts.uploadAvatar(user.sub, file),
    };
  }
  @Delete('me/avatar')
  async deleteAvatar(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.accounts.deleteAvatar(user.sub) };
  }
  @Get('profiles/:id/avatar')
  async avatar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response
  ) {
    const file = await this.accounts.avatar(user.sub, id);
    response.set('Cache-Control', 'private, no-store');
    if (file.url) return response.redirect(302, file.url);
    response.set({
      'Content-Type': file.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.send(file.buffer);
  }
}
