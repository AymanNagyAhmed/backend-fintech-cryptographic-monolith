import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  ApiErrorDetail,
  ApiFailure,
} from '../interfaces/api-response.interface.js';
import { DomainException } from '../exceptions/domain.exception.js';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware.js';
import { getRequestId } from '../request-context.js';

const INTERNAL_ERROR_MESSAGE =
  'An unexpected error occurred. Our team has been notified.';

interface ErrorParts {
  statusCode: number;
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

function codeForStatus(status: number): string {
  const name = HttpStatus[status] as string | undefined;
  return name ?? (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
}

function httpExceptionMessage(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('; ');
  return exception.message;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId =
      getRequestId() ?? String(req.headers[REQUEST_ID_HEADER] ?? '');

    const parts = this.toParts(exception);
    const expected = exception instanceof DomainException && exception.expose;
    if (parts.statusCode >= 500 && !expected) {
      const err =
        exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        { requestId, method: req.method, path: req.originalUrl, err },
        `${req.method} ${req.originalUrl} failed: ${err.message}`,
      );
    }

    const body: ApiFailure = {
      success: false,
      statusCode: parts.statusCode,
      error: {
        code: parts.code,
        message: parts.message,
        ...(parts.details?.length ? { details: parts.details } : {}),
      },
      meta: { requestId },
    };
    res.status(parts.statusCode).json(body);
  }

  private toParts(exception: unknown): ErrorParts {
    if (exception instanceof DomainException) {
      const statusCode = exception.statusCode;
      const hide = statusCode >= 500 && !exception.expose;
      return {
        statusCode,
        code: exception.code,
        message: hide ? INTERNAL_ERROR_MESSAGE : exception.message,
        details: hide ? undefined : exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: codeForStatus(statusCode),
        message:
          statusCode >= 500
            ? INTERNAL_ERROR_MESSAGE
            : httpExceptionMessage(exception),
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: INTERNAL_ERROR_MESSAGE,
    };
  }
}
