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
import { ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { HardwareAuthGuard } from '../hardware-devices/hardware-auth.guard';
import { UpdateSosLocationDto, UploadSosRecordingDto } from './dto/sos.dto';
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
