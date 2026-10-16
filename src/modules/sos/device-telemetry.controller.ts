import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HardwareAuthGuard } from '../hardware-devices/hardware-auth.guard';
import {
  CancelSosDto,
  UpdateSosLocationDto,
  UploadSosRecordingDto,
} from './dto/sos.dto';
import { SosService } from './sos.service';

@Public()
@UseGuards(HardwareAuthGuard)
@ApiTags('device-sos')
@ApiHeader({ name: 'X-Heros-Hardware-Id', required: true })
@ApiHeader({ name: 'X-Heros-Device-Token', required: true })
@Controller('device/sos')
export class DeviceTelemetryController {
  constructor(private readonly sos: SosService) {}

  @Get('active')
  async active(@Req() request: { hardware: { ownerId: string } }) {
    return {
      success: true,
      data: await this.sos.getActive(request.hardware.ownerId),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read an owned SOS, including its final status after reconnect',
  })
  async detail(
    @Req() request: { hardware: { ownerId: string } },
    @Param('id') id: string
  ) {
    return {
      success: true,
      data: await this.sos.getDeviceEvent(request.hardware.ownerId, id),
    };
  }

  @Post(':id/resolve')
  @ApiOperation({
    summary: 'Confirm that the device owner is safe and close the SOS',
  })
  async resolve(
    @Req() request: { hardware: { ownerId: string } },
    @Param('id') id: string
  ) {
    return {
      success: true,
      data: await this.sos.resolve(request.hardware.ownerId, id),
    };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel an owned SOS from the physical device' })
  async cancel(
    @Req() request: { hardware: { ownerId: string } },
    @Param('id') id: string,
    @Body() dto: CancelSosDto
  ) {
    return {
      success: true,
      data: await this.sos.cancel(request.hardware.ownerId, id, dto),
    };
  }

  @Put(':id/location')
  async location(
    @Req() request: { hardware: { ownerId: string } },
    @Param('id') id: string,
    @Body() dto: UpdateSosLocationDto
  ) {
    return {
      success: true,
      data: await this.sos.updateLocation(request.hardware.ownerId, id, dto),
    };
  }

  @Post(':id/recordings')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio', 'durationSeconds', 'clientRecordingId'],
      properties: {
        audio: { type: 'string', format: 'binary' },
        durationSeconds: { type: 'number', minimum: 0.1, maximum: 120 },
        clientRecordingId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3 },
    })
  )
  async recording(
    @Req() request: { hardware: { ownerId: string } },
    @Param('id') id: string,
    @Body() dto: UploadSosRecordingDto,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number }
  ) {
    if (!file) throw new BadRequestException({ code: 'SOS_AUDIO_REQUIRED' });
    if (!dto.clientRecordingId)
      throw new BadRequestException({ code: 'CLIENT_RECORDING_ID_REQUIRED' });
    return {
      success: true,
      data: await this.sos.addRecording(
        request.hardware.ownerId,
        id,
        file,
        dto
      ),
    };
  }
}
