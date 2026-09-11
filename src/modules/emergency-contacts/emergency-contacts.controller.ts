import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  CreateEmergencyContactDto,
  UpdateEmergencyContactDto,
} from './dto/emergency-contact.dto';
import { EmergencyContactsService } from './emergency-contacts.service';

@ApiTags('emergency-contacts')
@ApiBearerAuth('bearer-token')
@Controller('emergency-contacts')
export class EmergencyContactsController {
  constructor(private readonly contactsService: EmergencyContactsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.contactsService.list(user.sub) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmergencyContactDto
  ) {
    return {
      success: true,
      data: await this.contactsService.create(user.sub, dto),
    };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyContactDto
  ) {
    return {
      success: true,
      data: await this.contactsService.update(user.sub, id, dto),
    };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return {
      success: true,
      data: await this.contactsService.remove(user.sub, id),
    };
  }
}
