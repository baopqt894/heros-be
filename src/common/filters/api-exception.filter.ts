import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

type ExceptionBody = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
  statusCode?: unknown;
  [key: string]: unknown;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isHttpException) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${request.method} ${request.originalUrl || request.url}`,
        stack
      );
    }

    const error = this.normalizeError(
      status,
      isHttpException ? exception.getResponse() : undefined
    );
    response.status(status).json({
      success: false,
      code: status,
      data: {
        errorCode: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  private normalizeError(status: number, rawResponse: string | object) {
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      return {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      };
    }

    if (typeof rawResponse === 'string') {
      return {
        code: this.defaultCode(status),
        message: rawResponse,
      };
    }

    const body = (rawResponse || {}) as ExceptionBody;
    const validationMessages = Array.isArray(body.message)
      ? body.message.filter((message): message is string =>
          Boolean(message && typeof message === 'string')
        )
      : undefined;
    const code =
      typeof body.code === 'string'
        ? body.code
        : validationMessages?.length
          ? 'VALIDATION_ERROR'
          : this.defaultCode(status);
    const message = validationMessages?.length
      ? 'Request validation failed'
      : typeof body.message === 'string'
        ? body.message
        : this.defaultMessage(code, status);
    const extraDetails = Object.fromEntries(
      Object.entries(body).filter(
        ([key]) => !['code', 'error', 'message', 'statusCode'].includes(key)
      )
    );
    const details = validationMessages?.length
      ? validationMessages
      : Object.keys(extraDetails).length
        ? extraDetails
        : undefined;

    return {
      code,
      message,
      ...(details ? { details } : {}),
    };
  }

  private defaultCode(status: number) {
    const codes: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
    };
    return codes[status] || `HTTP_${status}`;
  }

  private defaultMessage(code: string, status: number) {
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: 'Email or password is incorrect',
      OTP_INVALID_OR_EXPIRED: 'OTP is invalid or expired',
      REFRESH_TOKEN_INVALID: 'Refresh token is invalid or expired',
      EMAIL_ALREADY_REGISTERED: 'Email is already registered',
      USER_NOT_FOUND: 'User was not found',
      AUTH_RATE_LIMITED: 'Too many authentication attempts',
      SOS_RATE_LIMITED: 'Too many SOS requests',
    };
    if (messages[code]) return messages[code];

    const statusName = HttpStatus[status];
    if (typeof statusName !== 'string') return 'Request failed';
    const sentence = statusName.toLowerCase().replace(/_/g, ' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }
}
