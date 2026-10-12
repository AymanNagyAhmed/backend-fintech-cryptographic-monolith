import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest, Role } from './auth.types.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';

/** Runs after JwtAuthGuard; a route without @Roles() only needs a valid token. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user?.roles.some((r) => required.includes(r))) return true;
    throw new ForbiddenException('Insufficient role');
  }
}
