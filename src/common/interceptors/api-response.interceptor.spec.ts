import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ApiResponseInterceptor } from './api-response.interceptor';

describe('ApiResponseInterceptor', () => {
  it('adds the numeric HTTP code to successful API responses', async () => {
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as unknown as ExecutionContext;
    const next = {
      handle: () => of({ success: true, data: { id: 'user-id' } }),
    } as CallHandler;

    await expect(
      firstValueFrom(new ApiResponseInterceptor().intercept(context, next))
    ).resolves.toEqual({
      success: true,
      code: 201,
      data: { id: 'user-id' },
    });
  });
});
