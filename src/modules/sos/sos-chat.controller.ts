import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SosChatService } from './sos-chat.service';
import {
  ListSosChatMessagesDto,
  ListSosChatsDto,
  SendSosChatMessageDto,
} from './dto/sos-chat.dto';

@ApiTags('sos-chats')
@ApiBearerAuth('bearer-token')
@Controller('sos-chats')
export class SosChatController {
  constructor(private readonly chats: SosChatService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSosChatsDto
  ) {
    return { success: true, data: await this.chats.list(user.sub, query) };
  }

  @Get(':sosId')
  @Header('Cache-Control', 'private, no-store')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sosId') id: string
  ) {
    return { success: true, data: await this.chats.get(user.sub, id) };
  }

  @Get(':sosId/messages')
  @Header('Cache-Control', 'private, no-store')
  async messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sosId') id: string,
    @Query() query: ListSosChatMessagesDto
  ) {
    return {
      success: true,
      data: await this.chats.messages(user.sub, id, query),
    };
  }

  @Post(':sosId/messages')
  @Header('Cache-Control', 'private, no-store')
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sosId') id: string,
    @Body() dto: SendSosChatMessageDto
  ) {
    return { success: true, data: await this.chats.send(user.sub, id, dto) };
  }
}
