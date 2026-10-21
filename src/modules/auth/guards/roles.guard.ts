import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service.js';
import {
  PRIVILEGED_ROLES,
  ROLES,
  type AuthenticatedRequest,
  type Role,
} from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { mfaRequired } from '../exceptions/auth.exceptions.js';

/**
 * Runs after JwtAuthGuard; a route without @Roles() only needs a valid token.
 * A route whose roles intersect approver, compliance, or admin decides from
 * auth.users.roles on this request. The token stays the proof of identity.
 * A privileged role only counts when the session passed TOTP.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new ForbiddenException('Insufficient role');

    const roles = await this.rolesFor(user.id, user.roles, required);
    if (!roles) throw new ForbiddenException('Insufficient role');
    const granted = roles.filter((role) => required.includes(role));
    if (!granted.length) throw new ForbiddenException('Insufficient role');
    if (!user.mfa && granted.every((role) => PRIVILEGED_ROLES.includes(role)))
      throw mfaRequired();
    return true;
  }

  private async rolesFor(
    userId: string,
    tokenRoles: Role[],
    required: Role[],
  ): Promise<Role[] | null> {
    if (!required.some((role) => PRIVILEGED_ROLES.includes(role)))
      return tokenRoles;
    const stored = await this.users.rolesOf(userId);
    if (!stored) return null;
    return stored.filter((role): role is Role =>
      (ROLES as readonly string[]).includes(role),
    );
  }
}
