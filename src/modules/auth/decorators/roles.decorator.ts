import { SetMetadata } from '@nestjs/common';
import type { Role } from '../auth.types.js';

export const ROLES_KEY = 'roles';

/** The caller needs at least one of these roles (checked by the global RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
