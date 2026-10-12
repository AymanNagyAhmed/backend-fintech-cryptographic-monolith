import { UserRole } from '../../generated/prisma/client.js';
import { ROLES } from './auth.types.js';

describe('ROLES', () => {
  it('matches the auth.user_role database enum', () => {
    expect([...ROLES].sort()).toEqual(Object.values(UserRole).sort());
  });
});
