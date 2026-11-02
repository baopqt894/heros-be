import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ProvisionHardwareDeviceDto } from './dto/provision-hardware-device.dto';
import { HardwareDevicesService } from './hardware-devices.service';
import { ActivateHardwareDeviceDto } from './dto/activate-hardware-device.dto';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';

@ApiTags('hardware-devices')
@ApiBearerAuth('bearer-token')
@Controller('me/heros-devices')
export class HardwareDevicesController {
  constructor(private readonly hardwareDevices: HardwareDevicesService, private readonly rateLimit: AuthRateLimitService) {}

  @Post('activate')
  @ApiOperation({ summary: 'Activate the device reserved for this buyer using the same code from email or QR. Does not rotate hardware credentials.' })
  async activate(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActivateHardwareDeviceDto) {
    this.rateLimit.consume(`hardware-activation:${user.sub}`, 10, 15 * 60_000);
    return { success: true, data: await this.hardwareDevices.activate(user.sub, dto.activationCode) };
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.hardwareDevices.list(user.sub) };
  }

  @Post()
  @ApiOperation({
    summary: 'Disabled legacy provisioning endpoint. Use activate with a purchase activation code.',
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
