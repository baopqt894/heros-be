import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  CancelSosDto,
  CreateSosDto,
  UpdateSmsStatusDto,
  UpdateSosLocationDto,
  UploadSosRecordingDto,
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

  @Post(':id/recordings')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio', 'durationSeconds'],
      properties: {
        audio: { type: 'string', format: 'binary' },
        durationSeconds: { type: 'number', maximum: 120, minimum: 0.1 },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    })
  )
  async uploadRecording(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    @Body() dto: UploadSosRecordingDto
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'SOS_AUDIO_REQUIRED' });
    }
    return {
      success: true,
      data: await this.sosService.addRecording(user.sub, id, file, dto),
    };
  }

  @Get(':id/recordings/:recordingId')
  @ApiProduces(
    'audio/aac',
    'audio/m4a',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav'
  )
  async playRecording(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('recordingId') recordingId: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const recording = await this.sosService.openRecording(
      user.sub,
      id,
      recordingId
    );
    response.set({
      'Content-Type': recording.mimeType,
      'Content-Length': String(recording.sizeBytes),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(recording.stream);
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
