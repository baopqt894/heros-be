import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class AuthRateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : current;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (bucket.count > limit) {
      throw new HttpException(
        {
          code: 'AUTH_RATE_LIMITED',
          retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    if (this.buckets.size > 10_000) this.prune(now);
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
