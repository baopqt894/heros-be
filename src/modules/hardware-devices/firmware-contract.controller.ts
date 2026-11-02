import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('hardware-devices')
@ApiBearerAuth('bearer-token')
@Controller('me/heros-devices/contract')
export class FirmwareContractController {
  @Get()
  getContract() {
    return {
      success: true,
      data: {
        version: '1.2',
        transport: 'HTTPS',
        basePath: '/v1',
        ownership: {
          mode: 'server_preassigned',
          profile: 'GET /v1/me',
          profileField: 'data.device',
          missingDevice: null,
          mobilePairingRequired: false,
          bluetoothRequired: false,
          activation: 'POST /v1/me/heros-devices/activate',
          activationInput: 'activationCode',
          activationMethods: ['purchase_email_code', 'qr_code'],
        },
        qr: {
          format: 'json',
          version: 1,
          example: { v: 1, type: 'heros-device-activation', hardwareId: 'HEROS-DEV-0001', activationCode: 'HRS-XXXX-XXXX-XXXX-XXXX-XXXX' },
          containsDeviceToken: false,
          containsActivationSecret: true,
        },
        authentication: {
          headers: ['X-Heros-Hardware-Id', 'X-Heros-Device-Token'],
          credentialSource: 'factory_provisioned_before_delivery',
          legacyProvisioningEndpoint: 'disabled',
        },
        sos: {
          create: 'POST /device/sos',
          active: 'GET /device/sos/active',
          idempotencyField: 'clientRequestId',
        },
        gps: {
          update: 'PUT /device/sos/:id/location',
          suggestedIntervalSeconds: 5,
          staleUpdates: 'ignored',
          maximumFutureSkewSeconds: 60,
        },
        audio: {
          upload: 'POST /device/sos/:id/recordings',
          encoding: 'multipart/form-data',
          fields: ['audio', 'durationSeconds', 'clientRecordingId'],
          suggestedClipSeconds: 10,
          maxClipSeconds: 120,
          maxClipBytes: 10485760,
          maxEventBytes: 104857600,
          maxEventClips: 600,
          delivery: 'completed_clips_not_continuous_stream',
        },
        retry: {
          statuses: [408, 429, 500, 502, 503, 504],
          backoffSeconds: [1, 2, 4, 8, 16, 30],
          jitter: true,
          reuseRequestIds: true,
        },
        firmwareApproval: 'pending',
        ble: {
          status: 'not_required',
          serviceUuid: null,
          characteristics: [],
        },
        buttons: {
          status: 'pending_firmware_agreement',
          actions: ['trigger_sos', 'start_recording'],
          pressDurations: null,
        },
        leds: {
          status: 'pending_firmware_agreement',
          states: [
            'idle',
            'sending',
            'sos_confirmed',
            'recording',
            'offline',
            'low_battery',
          ],
          colors: null,
        },
      },
    };
  }
}
