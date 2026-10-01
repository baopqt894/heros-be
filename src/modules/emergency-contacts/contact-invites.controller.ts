import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ContactInvitesService } from './contact-invites.service';

export class IssueContactInviteDto {
  @ApiProperty({
    description: 'Verified login email the invited person will use.',
  })
  @IsEmail()
  email: string;
}

export class AcceptContactInviteDto {
  @ApiProperty({
    description: '32 hexadecimal characters from the invitation link.',
  })
  @Matches(/^[a-fA-F0-9]{32}$/)
  code: string;
}

@ApiTags('contact-invites')
@ApiBearerAuth('bearer-token')
@Controller('contact-invites')
export class ContactInvitesController {
  constructor(private readonly invites: ContactInvitesService) {}

  @Post('accept')
  async accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptContactInviteDto
  ) {
    return {
      success: true,
      data: await this.invites.accept(user.sub, dto.code),
    };
  }

  @Post(':contactId')
  async issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('contactId') id: string,
    @Body() dto: IssueContactInviteDto
  ) {
    return {
      success: true,
      data: await this.invites.issue(user.sub, id, dto.email),
    };
  }

  @Delete(':contactId')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('contactId') id: string
  ) {
    return { success: true, data: await this.invites.revoke(user.sub, id) };
  }
}
