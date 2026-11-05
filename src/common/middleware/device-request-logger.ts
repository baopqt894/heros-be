import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

function safePath(url: string) {
  const path = url.split('?')[0];
  if (/^(\/v1)?\/me\/devices(?:\/[^/]+)?\/?$/i.test(path))
    return path.replace(/(\/me\/devices)\/[^/]+\/?$/i, '$1/:installationId');
  const match = path.match(
    /^(\/v1)?\/(device\/sos|sos)(?:\/(active|ping|[a-f\d]{24}))?(?:\/(location|recordings|resolve|cancel|rescue-status))?\/?$/i
  );
  if (match) {
    const segment = match[3];
    return `${match[1] || ''}/${match[2]}${segment ? `/${/^[a-f\d]{24}$/i.test(segment) ? ':sosId' : segment}` : ''}${match[4] ? `/${match[4]}` : ''}`;
  }
  if (/^(\/v1)?\/device\/status\/?$/i.test(path)) return path;
  return /^(\/v1)?\/device(?:\/|$)/i.test(path)
    ? '/device/[unrecognized-path]'
    : '[unrecognized-path]';
}

export function deviceRequestLogger(
  logger: Pick<Logger, 'log' | 'warn'> = new Logger('DeviceHttp')
) {
  return (request: Request, response: Response, next: NextFunction) => {
    const path = (request.originalUrl || request.url).split('?')[0];
    const hasHardwareId = Boolean(request.headers['x-heros-hardware-id']);
    const hasDeviceToken = Boolean(request.headers['x-heros-device-token']);
    const isPushRegistration = /^(\/v1)?\/me\/devices(?:\/|$)/i.test(path);
    if (
      !/^(\/v1)?\/device(?:\/|$)/i.test(path) &&
      !isPushRegistration &&
      !hasHardwareId &&
      !hasDeviceToken
    ) {
      next();
      return;
    }

    const requestId = randomUUID();
    const startedAt = Date.now();
    const method = /^[A-Z]{1,16}$/.test(request.method)
      ? request.method
      : 'UNKNOWN';
    const context = `requestId=${requestId} method=${method} path=${safePath(path)}`;
    const prefix = isPushRegistration ? 'PUSH_DEVICE_HTTP' : 'DEVICE_HTTP';
    response.locals.deviceRequestId = requestId;
    response.setHeader('X-Heros-Request-Id', requestId);
    logger.log(
      `${prefix}_IN ${context} hardwareIdPresent=${hasHardwareId} deviceTokenPresent=${hasDeviceToken}`
    );

    let completed = false;
    const complete = (aborted: boolean) => {
      if (completed) return;
      completed = true;
      const rawCode = response.locals.deviceErrorCode;
      const errorCode =
        typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode)
          ? rawCode
          : response.statusCode >= 400
            ? `HTTP_${response.statusCode}`
            : 'NONE';
      const authenticated = Boolean(
        isPushRegistration
          ? (request as Request & { user?: unknown }).user
          : (request as Request & { hardware?: unknown }).hardware
      );
      const summary = `${prefix}_OUT ${context} status=${aborted ? 'ABORTED' : response.statusCode} durationMs=${Date.now() - startedAt} authenticated=${authenticated} errorCode=${errorCode}`;
      if (aborted || response.statusCode >= 400) logger.warn(summary);
      else logger.log(summary);
    };
    response.once('finish', () => complete(false));
    response.once('close', () => complete(!response.writableFinished));
    next();
  };
}
