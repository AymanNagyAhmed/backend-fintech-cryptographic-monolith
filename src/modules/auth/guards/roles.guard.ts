import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PRIVILEGED_ROLES,
  type AuthenticatedRequest,
  type Role,
} from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { mfaRequired } from '../exceptions/auth.exceptions.js';

/**
 * Runs after JwtAuthGuard; a route without @Roles() only needs a valid token. A privileged
 * role (approver, compliance, admin) only counts when the session passed TOTP.
 */
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
    const granted = user?.roles.filter((r) => required.includes(r)) ?? [];
    if (!granted.length) throw new ForbiddenException('Insufficient role');
    if (!user!.mfa && granted.every((r) => PRIVILEGED_ROLES.includes(r)))
      throw mfaRequired();
    return true;
  }
}
