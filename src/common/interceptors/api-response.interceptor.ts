import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';

type ApiSuccessBody = {
  success?: boolean;
  data?: unknown;
};

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: ApiSuccessBody) => {
        if (!body || body.success !== true) return body;
        return {
          success: true,
          code: response.statusCode,
          data: body.data,
        };
      })
    );
  }
}
