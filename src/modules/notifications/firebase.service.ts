import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT } from 'google-auth-library';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private readonly projectId?: string;
  private readonly client: JWT | null;

  constructor(config: ConfigService) {
    this.projectId = config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = config
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');
    this.client =
      this.projectId && clientEmail && privateKey
        ? new JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
          })
        : null;
    if (!this.client) {
      this.logger.warn(
        'Firebase is not configured; push notifications are disabled'
      );
    }
  }

  async send(
    tokens: string[],
    data: Record<string, string>,
    title = 'Heros SOS'
  ) {
    if (!this.client || !this.projectId || !tokens.length) {
      return { sent: 0, failed: 0, disabled: !this.client };
    }
    const accessToken = await this.client.getAccessToken();
    if (!accessToken.token)
      throw new Error('Could not obtain Firebase access token');
    let sent = 0;
    let failed = 0;
    for (let offset = 0; offset < tokens.length; offset += 10) {
      const results = await Promise.allSettled(
        tokens
          .slice(offset, offset + 10)
          .map((token) =>
            this.sendOne(accessToken.token as string, token, data, title)
          )
      );
      sent += results.filter((result) => result.status === 'fulfilled').length;
      failed += results.filter((result) => result.status === 'rejected').length;
    }
    return { sent, failed, disabled: false };
  }

  private async sendOne(
    accessToken: string,
    token: string,
    data: Record<string, string>,
    title: string
  ) {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: data.message },
            data,
            android: { priority: 'high' },
            apns: {
              payload: { aps: { sound: 'default', 'content-available': 1 } },
            },
          },
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`FCM request failed with status ${response.status}`);
    }
  }
}
