import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AvatarUploadService {
  constructor(private readonly config: ConfigService) {}

  async upload(file: { buffer: Buffer; mimetype: string }) {
    const key = this.config.get<string>('LIMGROW_UPLOAD_API_KEY');
    if (!key)
      throw new ServiceUnavailableException({
        code: 'AVATAR_UPLOAD_NOT_CONFIGURED',
      });
    const extension = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    }[file.mimetype];
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      `avatar.${extension}`
    );
    form.append('type', 'image');
    try {
      const response = await fetch(
        'https://upload-services.limgrow.com/upload',
        {
          method: 'POST',
          headers: { accept: '*/*', 'x-api-key': key },
          body: form,
          signal: AbortSignal.timeout(20_000),
          redirect: 'error',
        }
      );
      if (!response.ok) throw new Error('Upload rejected');
      const body = (await response.json()) as { url?: unknown };
      if (typeof body.url !== 'string' || body.url.length > 2048)
        throw new Error('Missing URL');
      const url = new URL(body.url);
      if (
        url.origin !== 'https://storages.limgrow.com' ||
        url.username ||
        url.password ||
        !url.pathname.startsWith('/uploads/')
      )
        throw new Error('Unexpected storage URL');
      return url.href;
    } catch {
      // Do not expose provider response bodies, credentials or multipart data.
      throw new BadGatewayException({ code: 'AVATAR_UPLOAD_FAILED' });
    }
  }
}
