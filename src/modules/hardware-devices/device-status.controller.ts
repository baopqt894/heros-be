import { Body, Controller, Headers, Put } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { UpdateHardwareStatusDto } from './dto/update-hardware-status.dto';
import { HardwareDevicesService } from './hardware-devices.service';

@ApiTags('device-status')
@Controller('device/status')
export class DeviceStatusController {
  constructor(private readonly hardwareDevices: HardwareDevicesService) {}

  @Public()
  @Put()
  @ApiOperation({ summary: 'Report battery status from a physical device' })
  @ApiHeader({ name: 'X-Heros-Hardware-Id', required: true })
  @ApiHeader({ name: 'X-Heros-Device-Token', required: true })
  async update(
    @Headers('x-heros-hardware-id') hardwareId: string,
    @Headers('x-heros-device-token') deviceToken: string,
    @Body() dto: UpdateHardwareStatusDto
  ) {
    const device = await this.hardwareDevices.authenticate(
      hardwareId,
      deviceToken
    );
    return {
      success: true,
      data: await this.hardwareDevices.updateStatus(device.deviceId, dto),
    };
  }
}
