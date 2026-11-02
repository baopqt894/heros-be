import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('Device activation email', () => {
  it('sends the code and both activation methods without hardware credentials', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(new ConfigService({ SMTP_HOST: 'smtp.test.invalid', EMAIL_FROM: 'test@test.invalid' }));
    await service.sendDeviceActivation('buyer@test.invalid', { activationCode: 'HRS-1234-5678-9ABC-DEFG-HJKM', hardwareId: 'HEROS-001', orderCode: 123 });
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe('buyer@test.invalid');
    expect(message.text).toContain('HRS-1234-5678-9ABC-DEFG-HJKM');
    expect(message.text).toContain('quét QR');
    expect(message.text).not.toContain('hdv_');
  });
  it('fails explicitly without SMTP rather than pretending email was sent', async () => {
    const service = new EmailService(new ConfigService({ SMTP_HOST: '' }));
    await expect(service.sendDeviceActivation('buyer@test.invalid', { activationCode: 'test', hardwareId: 'HEROS-001', orderCode: 123 })).rejects.toMatchObject({ response: { code: 'EMAIL_NOT_CONFIGURED' } });
  });
});
