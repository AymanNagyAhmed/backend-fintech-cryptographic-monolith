import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { ApiSuccess } from '../interfaces/api-response.interface.js';
import { DEFAULT_RESPONSE_MESSAGE, RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator.js';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware.js';
import { getRequestId } from '../request-context.js';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_RESPONSE_MESSAGE;

    return next.handle().pipe(
      map((data: unknown): unknown => {
        if (data instanceof StreamableFile) return data;
        const body: ApiSuccess<unknown> = {
          success: true,
          statusCode: res.statusCode,
          message,
          data: data ?? null,
          meta: { requestId: getRequestId() ?? String(req.headers[REQUEST_ID_HEADER] ?? '') },
        };
        return body;
      }),
    );
  }
}
