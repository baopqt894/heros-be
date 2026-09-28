import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../auth/email.service';
import { DevicesService } from '../devices/devices.service';
import { FirebaseService } from './firebase.service';

export interface SosNotificationInput {
  eventId: string;
  code: string;
  ownerName: string;
  message: string;
  mapUrl: string;
  pushUserIds: string[];
  emails: string[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly devicesService: DevicesService,
    private readonly firebaseService: FirebaseService,
    private readonly emailService: EmailService
  ) {}

  dispatchSos(input: SosNotificationInput) {
    void this.performDispatch(input).catch((error) => {
      this.logger.error(
        `SOS notification dispatch failed for ${input.eventId}`,
        error
      );
    });
  }

  dispatchPush(
    pushUserIds: string[],
    data: Record<string, string>,
    title = 'Heros SOS'
  ) {
    void this.performPush(pushUserIds, data, title).catch((error) => {
      this.logger.error('Push notification dispatch failed', error);
    });
  }

  private async performPush(
    pushUserIds: string[],
    data: Record<string, string>,
    title: string
  ) {
    const tokens = await this.devicesService.findPushTokens([
      ...new Set(pushUserIds),
    ]);
    return this.firebaseService.send(tokens, data, title);
  }

  private async performDispatch(input: SosNotificationInput) {
    const tokens = await this.devicesService.findPushTokens([
      ...new Set(input.pushUserIds),
    ]);
    const tasks: Promise<unknown>[] = [
      this.firebaseService.send(
        tokens,
        {
          type: 'SOS_CREATED',
          sosId: input.eventId,
          code: input.code,
          message: `${input.ownerName}: ${input.message}`,
        },
        'Tín hiệu SOS'
      ),
      ...[...new Set(input.emails)].map((email) =>
        this.emailService.sendSos(email, input)
      ),
    ];
    const results = await Promise.allSettled(tasks);
    results.forEach((result) => {
      if (result.status === 'rejected') this.logger.error(result.reason);
    });
  }
}
