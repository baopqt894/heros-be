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
    tokens = [...new Set(tokens.filter(Boolean))];
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
      for (const result of results) {
        if (result.status === 'rejected')
          this.logger.warn(
            `FCM_DELIVERY_FAILED type=${data.type || 'UNKNOWN'} ${result.reason instanceof Error ? result.reason.message : 'UNKNOWN'}`
          );
      }
    }
    return { sent, failed, disabled: false };
  }

  private async sendOne(
    accessToken: string,
    token: string,
    data: Record<string, string>,
    title: string
  ) {
    const notificationKey = `${data.sosId || 'heros'}:${data.type || 'notification'}`;
    const body = JSON.stringify({
      message: {
        token,
        notification: { title, body: data.message },
        data,
        android: {
          priority: 'high',
          notification: { sound: 'default', tag: notificationKey },
        },
        apns: {
          headers: {
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-collapse-id': notificationKey.slice(0, 64),
          },
          payload: { aps: { sound: 'default', 'content-available': 1 } },
        },
      },
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body,
            signal: AbortSignal.timeout(10000),
          }
        );
      } catch {
        if (attempt === 0) continue;
        throw new Error('FCM_NETWORK_OR_TIMEOUT');
      }
      if (response.ok) return;
      let code = 'UNKNOWN';
      try {
        const error = await response.json();
        const upstream =
          error.error?.details?.find(
            (item: { errorCode?: string }) => item.errorCode
          )?.errorCode || error.error?.status;
        if (typeof upstream === 'string' && /^[A-Z_]+$/.test(upstream))
          code = upstream;
      } catch {}
      const retryHeader = response.headers.get('Retry-After');
      const retrySeconds = Number(retryHeader);
      const retryMs = retryHeader
        ? Number.isFinite(retrySeconds)
          ? retrySeconds * 1000
          : Date.parse(retryHeader) - Date.now()
        : 250;
      // Never shorten provider backoff. Long backoffs/quota errors are surfaced
      // for monitoring instead of retried inside this bounded fast delivery path.
      if (
        attempt === 0 &&
        response.status >= 500 &&
        Number.isFinite(retryMs) &&
        retryMs <= 1000
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(250, retryMs))
        );
        continue;
      }
      throw new Error(`FCM_HTTP_${response.status}_${code}`);
    }
  }
}
