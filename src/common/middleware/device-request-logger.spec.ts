import {
  CanActivate,
  Controller,
  ExecutionContext,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';
import { ApiExceptionFilter } from '../filters/api-exception.filter';
import { deviceRequestLogger } from './device-request-logger';

class FixtureGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.headers['x-heros-device-token'] !== 'test-secret') {
      throw new UnauthorizedException({ code: 'DEVICE_CREDENTIAL_INVALID' });
    }
    req.hardware = { ownerId: 'private-owner-id' };
    return true;
  }
}

@Controller('device/sos')
class FixtureController {
  @Post()
  create() {
    return { id: 'test-id' };
  }
}

describe('Device HTTP diagnostics', () => {
  let app: INestApplication;
  let base: string;
  const logger = { log: jest.fn(), warn: jest.fn() };
  const headers = {
    'content-type': 'application/json',
    'x-heros-hardware-id': 'PRIVATE-HARDWARE-ID',
    'x-heros-device-token': 'test-secret',
  };
  const output = () =>
    [...logger.log.mock.calls, ...logger.warn.mock.calls].flat().join('\n');

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FixtureController],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.use(deviceRequestLogger(logger));
    app.setGlobalPrefix('v1');
    app.useGlobalGuards(new FixtureGuard());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('logs arrival and success without exposing headers, query or body', async () => {
    const response = await fetch(`${base}/v1/device/sos?token=QUERY-SECRET`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'PRIVATE-MESSAGE', latitude: 10.12345 }),
    });
    await response.text();
    expect(response.status).toBe(201);
    const requestId = response.headers.get('x-heros-request-id');
    expect(requestId).toMatch(/^[a-f\d-]{36}$/);
    expect(output()).toContain(`DEVICE_HTTP_IN requestId=${requestId}`);
    expect(output()).toContain(`DEVICE_HTTP_OUT requestId=${requestId}`);
    expect(output()).toContain('status=201');
    expect(output()).toContain('authenticated=true');
    for (const secret of [
      'PRIVATE-HARDWARE-ID',
      'test-secret',
      'QUERY-SECRET',
      'PRIVATE-MESSAGE',
      '10.12345',
      'private-owner-id',
    ]) {
      expect(output()).not.toContain(secret);
    }
  });

  it('logs missing credentials rejected by a guard', async () => {
    const response = await fetch(`${base}/v1/device/sos`, { method: 'POST' });
    await response.text();
    expect(response.status).toBe(401);
    expect(output()).toContain(
      'hardwareIdPresent=false deviceTokenPresent=false'
    );
    expect(output()).toContain(
      'authenticated=false errorCode=DEVICE_CREDENTIAL_INVALID'
    );
  });

  it('captures invalid JSON before guards and controllers', async () => {
    const response = await fetch(`${base}/v1/device/sos`, {
      method: 'POST',
      headers,
      body: '{invalid',
    });
    await response.text();
    expect(response.status).toBe(400);
    expect(output()).toContain('DEVICE_HTTP_IN');
    expect(output()).toContain('status=400');
    expect(output()).not.toContain('{invalid');
  });

  it('captures incorrect prefix and unknown URLs without logging arbitrary path data', async () => {
    for (const path of [
      '/device/sos',
      '/v1/device/SECRET-IN-PATH',
      '/wrong/SECRET-IN-PATH',
    ]) {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
      });
      await response.text();
      expect(response.status).toBe(404);
    }
    expect(output()).toContain('path=/device/sos');
    expect(output()).toContain('path=/device/[unrecognized-path]');
    expect(output()).toContain('path=[unrecognized-path]');
    expect(output()).not.toContain('SECRET-IN-PATH');
  });

  it('does not log unrelated mobile requests', async () => {
    const response = await fetch(`${base}/v1/health`);
    await response.text();
    expect(output()).toBe('');
  });

  it('redacts SOS identifiers and logs an aborted request only once', () => {
    const request = {
      method: 'POST',
      url: '/v1/device/sos/6ae446e5af60881326078001/recordings',
      headers,
    } as unknown as Request;
    const response = Object.assign(new EventEmitter(), {
      locals: {},
      setHeader: jest.fn(),
      statusCode: 200,
      writableFinished: false,
    });
    const next = jest.fn();
    deviceRequestLogger(logger)(request, response as unknown as Response, next);
    response.emit('close');
    response.emit('finish');
    expect(next).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(output()).toContain('path=/v1/device/sos/:sosId/recordings');
    expect(output()).toContain('status=ABORTED');
    expect(output()).not.toContain('6ae446e5af60881326078001');
  });
});
