import { randomBytes } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from '../request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';
// Client ids end up in logs and audit records, so only short, plain values are accepted
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function newRequestId(): string {
  return `req_${randomBytes(12).toString('hex')}`;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use = (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : newRequestId();
    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestContext.run({ requestId }, next);
  };
}
