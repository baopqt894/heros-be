import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor(private readonly config: ConfigService) {
    if (
      this.config.get('NODE_ENV') === 'production' &&
      this.config.get('EMAIL_DEV_LOG_OTP') === 'true'
    ) {
      throw new Error('EMAIL_DEV_LOG_OTP must be false in production');
    }
    const host = this.config.get<string>('SMTP_HOST');
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(this.config.get('SMTP_PORT') || 587),
          secure: this.config.get('SMTP_SECURE') === 'true',
          auth: {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          },
        })
      : null;
  }

  async sendOtp(email: string, code: string, expiresInMinutes: number) {
    if (!this.transporter) {
      if (this.config.get('EMAIL_DEV_LOG_OTP') === 'true') {
        this.logger.warn(`[DEV ONLY] OTP for ${email}: ${code}`);
        return;
      }
      throw new ServiceUnavailableException({
        code: 'EMAIL_NOT_CONFIGURED',
        message: 'Email delivery is not configured',
      });
    }

    await this.transporter.sendMail({
      from: this.config.get<string>('EMAIL_FROM'),
      to: email,
      subject: 'Mã đăng nhập SOS của bạn',
      text: `Mã OTP của bạn là ${code}. Mã hết hạn sau ${expiresInMinutes} phút. Không chia sẻ mã này với bất kỳ ai.`,
      html: `<p>Mã OTP của bạn là <strong>${code}</strong>.</p><p>Mã hết hạn sau ${expiresInMinutes} phút. Không chia sẻ mã này với bất kỳ ai.</p>`,
    });
  }

  async sendSos(
    email: string,
    input: { ownerName: string; message: string; mapUrl: string; code: string }
  ) {
    if (!this.transporter)
      throw new ServiceUnavailableException('Email delivery is not configured');
    await this.transporter.sendMail({
      from: this.config.get<string>('EMAIL_FROM'),
      to: email,
      subject: `[SOS] ${input.ownerName} đang cần trợ giúp`,
      text: `${input.ownerName} đang phát tín hiệu SOS.\n${input.message}\nVị trí: ${input.mapUrl}\nMã sự kiện: ${input.code}`,
      html: `<p><strong>${this.escapeHtml(input.ownerName)}</strong> đang phát tín hiệu SOS.</p><p>${this.escapeHtml(input.message)}</p><p><a href="${input.mapUrl}">Xem vị trí trên bản đồ</a></p><p>Mã sự kiện: ${this.escapeHtml(input.code)}</p>`,
    });
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>'"]/g, (character) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[character];
    });
  }
}
