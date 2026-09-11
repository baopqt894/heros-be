import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@ApiBearerAuth('bearer-token')
@Controller('me/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto
  ) {
    return {
      success: true,
      data: await this.devicesService.register(user.sub, dto),
    };
  }

  @Delete(':deviceId')
  async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string
  ) {
    await this.devicesService.disable(user.sub, deviceId);
    return { success: true, data: { disabled: true } };
  }
}
