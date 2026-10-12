import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../auth.types.js';

/** The verified caller; throws on a route marked @Public() where no token was checked. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException('Authentication required');
    return user;
  },
);
