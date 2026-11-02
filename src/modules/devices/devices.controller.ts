import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { diagnosticFingerprint } from '../../common/utils/diagnostic-fingerprint';

@ApiTags('devices')
@ApiBearerAuth('bearer-token')
@Controller('me/devices')
export class DevicesController {
  private readonly logger = new Logger(DevicesController.name);
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  async register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto
  ) {
    const context = `userId=${user.sub} installationFingerprint=${diagnosticFingerprint(dto.deviceId)} tokenFingerprint=${diagnosticFingerprint(dto.pushToken)} platform=${dto.platform}`;
    this.logger.log(`PUSH_TOKEN_REGISTER_RECEIVED ${context}`);
    if (dto.deviceId !== user.deviceId) {
      this.logger.warn(
        `PUSH_TOKEN_REGISTER_REJECTED ${context} reason=SESSION_DEVICE_MISMATCH`
      );
      throw new BadRequestException({ code: 'SESSION_DEVICE_MISMATCH' });
    }
    return {
      success: true,
      data: await this.devicesService.register(user.sub, dto, user.sessionKey),
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
