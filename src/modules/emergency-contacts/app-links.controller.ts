import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import type { Response } from 'express';
import { join } from 'node:path';

@Controller()
export class AppLinksController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get('app-config')
  appConfig() {
    const channel =
      this.config.get('APP_DISTRIBUTION_CHANNEL') === 'store'
        ? 'store'
        : 'testflight';
    return {
      success: true,
      data: {
        distributionChannel: channel,
        iosDownloadUrl: this.httpsUrl(
          channel === 'store' ? 'IOS_APP_STORE_URL' : 'IOS_TESTFLIGHT_URL'
        ),
        androidDownloadUrl: this.httpsUrl('ANDROID_DOWNLOAD_URL'),
        inviteBaseUrl:
          this.httpsUrl('APP_INVITE_BASE_URL') ||
          'https://heros.nextteam.site/invite',
        invitationRequiresVerifiedEmail: true,
      },
    };
  }

  @Public()
  @Get('invite')
  invite(@Res() response: Response) {
    response.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    return response.sendFile(join(process.cwd(), 'public', 'invite.html'));
  }

  @Public()
  @Get('.well-known/apple-app-site-association')
  association(@Res() response: Response) {
    const ids = (this.config.get<string>('APPLE_APP_IDS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(s));
    return response.set('Cache-Control', 'public, max-age=300').json({
      applinks: {
        apps: [],
        details: ids.map((appID) => ({ appID, paths: ['/invite'] })),
      },
    });
  }

  private httpsUrl(key: string) {
    const value = this.config.get<string>(key);
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  }
}
