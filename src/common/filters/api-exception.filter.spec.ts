import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  function createHost() {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/v1/auth/login' }),
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  }

  it('wraps application error codes in the standard envelope', () => {
    const { host, status, json } = createHost();

    new ApiExceptionFilter().catch(
      new UnauthorizedException({ code: 'INVALID_CREDENTIALS' }),
      host
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      code: 401,
      data: {
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      },
    });
  });

  it('returns validation messages as details', () => {
    const { host, status, json } = createHost();

    new ApiExceptionFilter().catch(
      new BadRequestException(['email must be an email']),
      host
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      code: 400,
      data: {
        errorCode: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: ['email must be an email'],
      },
    });
  });

  it('does not expose unexpected internal errors', () => {
    const { host, status, json } = createHost();
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    new ApiExceptionFilter().catch(new Error('database password leaked'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      code: 500,
      data: {
        errorCode: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    });
    logger.mockRestore();
  });
});
