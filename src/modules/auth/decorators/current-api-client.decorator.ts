import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ApiClientRef, AuthenticatedRequest } from '../auth.types.js';

/** The verified B2B caller; throws on a route without @SignedRequest(). */
export const CurrentApiClient = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ApiClientRef => {
    const client = ctx
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().apiClient;
    if (!client) throw new UnauthorizedException('Signed request required');
    return client;
  },
);
