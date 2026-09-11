import { HttpException } from '@nestjs/common';
import { AuthRateLimitService } from './auth-rate-limit.service';

describe('AuthRateLimitService', () => {
  it('rejects calls after the configured limit', () => {
    const service = new AuthRateLimitService();
    service.consume('otp:ip:127.0.0.1', 2, 60_000);
    service.consume('otp:ip:127.0.0.1', 2, 60_000);

    expect(() => service.consume('otp:ip:127.0.0.1', 2, 60_000)).toThrow(
      HttpException
    );
  });

  it('keeps independent keys independent', () => {
    const service = new AuthRateLimitService();
    service.consume('first', 1, 60_000);

    expect(() => service.consume('second', 1, 60_000)).not.toThrow();
  });
});
