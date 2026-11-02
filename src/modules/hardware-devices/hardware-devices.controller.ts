import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ProvisionHardwareDeviceDto } from './dto/provision-hardware-device.dto';
import { HardwareDevicesService } from './hardware-devices.service';

@ApiTags('hardware-devices')
@ApiBearerAuth('bearer-token')
@Controller('me/heros-devices')
export class HardwareDevicesController {
  constructor(private readonly hardwareDevices: HardwareDevicesService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.hardwareDevices.list(user.sub) };
  }

  @Post()
  @ApiOperation({
    summary: 'Pair or rotate credentials for a physical HEROS device',
  })
  async provision(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProvisionHardwareDeviceDto
  ) {
    return {
      success: true,
      data: await this.hardwareDevices.provision(user.sub, dto),
    };
  }

  @Delete(':hardwareId')
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hardwareId') hardwareId: string
  ) {
    return {
      success: true,
      data: await this.hardwareDevices.revoke(user.sub, hardwareId),
    };
  }
}
