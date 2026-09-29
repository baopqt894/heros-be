import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HardwareDevicesService } from '../hardware-devices/hardware-devices.service';
import { CreateSosDto } from './dto/sos.dto';
import { SosService } from './sos.service';

@ApiTags('device-sos')
@Controller('device/sos')
export class DeviceSosController {
  constructor(
    private readonly hardwareDevices: HardwareDevicesService,
    private readonly sosService: SosService
  ) {}

  @Public()
  @Get('ping')
  @ApiOperation({ summary: 'Verify physical-device credentials' })
  @ApiHeader({ name: 'X-Heros-Hardware-Id', required: true })
  @ApiHeader({ name: 'X-Heros-Device-Token', required: true })
  async ping(
    @Headers('x-heros-hardware-id') hardwareId: string,
    @Headers('x-heros-device-token') deviceToken: string
  ) {
    const device = await this.hardwareDevices.authenticate(
      hardwareId,
      deviceToken
    );
    return {
      success: true,
      data: {
        connected: true,
        hardwareId: device.hardwareId,
        serverTime: new Date().toISOString(),
      },
    };
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Create an SOS directly from a physical device' })
  @ApiHeader({ name: 'X-Heros-Hardware-Id', required: true })
  @ApiHeader({ name: 'X-Heros-Device-Token', required: true })
  async create(
    @Headers('x-heros-hardware-id') hardwareId: string,
    @Headers('x-heros-device-token') deviceToken: string,
    @Body() dto: CreateSosDto
  ) {
    const device = await this.hardwareDevices.authenticate(
      hardwareId,
      deviceToken
    );
    return {
      success: true,
      data: await this.sosService.create(device.ownerId, dto),
    };
  }
}
