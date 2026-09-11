import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  CancelSosDto,
  CreateSosDto,
  UpdateSmsStatusDto,
  UpdateSosLocationDto,
} from './dto/sos.dto';
import { SosService } from './sos.service';

@ApiTags('sos')
@ApiBearerAuth('bearer-token')
@Controller('sos')
export class SosController {
  constructor(private readonly sosService: SosService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSosDto
  ) {
    return { success: true, data: await this.sosService.create(user.sub, dto) };
  }

  @Get('active')
  async active(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.sosService.getActive(user.sub) };
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return { success: true, data: await this.sosService.getOne(user.sub, id) };
  }

  @Put(':id/location')
  async location(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSosLocationDto
  ) {
    return {
      success: true,
      data: await this.sosService.updateLocation(user.sub, id, dto),
    };
  }

  @Post(':id/acknowledge')
  async acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return {
      success: true,
      data: await this.sosService.acknowledge(user.sub, id),
    };
  }

  @Post(':id/resolve')
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return { success: true, data: await this.sosService.resolve(user.sub, id) };
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelSosDto
  ) {
    return {
      success: true,
      data: await this.sosService.cancel(user.sub, id, dto),
    };
  }

  @Put(':id/sms-status')
  async smsStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSmsStatusDto
  ) {
    return {
      success: true,
      data: await this.sosService.updateSmsStatus(user.sub, id, dto),
    };
  }
}
