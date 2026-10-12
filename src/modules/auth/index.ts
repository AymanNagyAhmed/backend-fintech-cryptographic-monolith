// Public contract of the auth module for other modules
export { AuthModule } from './auth.module.js';
export { ROLES, type AuthUser, type Role } from './auth.types.js';
export { CurrentUser } from './decorators/current-user.decorator.js';
export { Roles } from './decorators/roles.decorator.js';
