import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { UsersModule } from '../src/modules/users/users.module.js';
import { UsersService } from '../src/modules/users/users.service.js';

// Needs the Compose PostgreSQL (`make up`) with the CreateUsers migration applied.
// app_writer cannot DELETE, so every run uses fresh emails and leaves its rows behind.
describe('UsersService (database)', () => {
  let prisma: PrismaService;
  let users: UsersService;
  const email = () => `e2e-${randomUUID()}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        UsersModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    users = moduleRef.get(UsersService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a user with a UUID v7 id, default role and status, no hash in the result', async () => {
    const address = email();
    const user = await users.create({
      email: address.toUpperCase(),
      password: 'S3cure!pass-123',
    });
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(user).toMatchObject({
      email: address,
      status: 'active',
      roles: [UserRole.user],
    });
    expect(user).not.toHaveProperty('passwordHash');
    await expect(
      users.findByEmail(address.toUpperCase()),
    ).resolves.toMatchObject({ id: user.id });
  });

  it('verifies credentials with the default argon2id parameters', async () => {
    const address = email();
    const { id } = await users.create({ email: address, password: 'pw-1' });
    const [row] = await prisma.$queryRaw<{ password_hash: string }[]>`
      SELECT password_hash FROM auth.users WHERE id = ${id}::uuid`;
    expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    await expect(
      users.verifyCredentials(address, 'pw-1'),
    ).resolves.toMatchObject({ id });
    await expect(users.verifyCredentials(address, 'pw-2')).resolves.toBeNull();
    await expect(users.verifyCredentials(email(), 'pw-1')).resolves.toBeNull();
  });

  it('rejects the same email in another case with EMAIL_TAKEN', async () => {
    const address = email();
    await users.create({ email: address, password: 'pw' });
    await expect(
      users.create({ email: ` ${address.toUpperCase()} `, password: 'pw' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', statusCode: 409 });
  });

  it.each([
    [
      'a non-normalized email',
      'Mixed@Example.com',
      '$argon2id$v=19$m=1,t=1,p=1$a$b',
      `ARRAY['user']`,
      /users_email_normalized_chk/,
    ],
    [
      'a non-argon2id hash',
      'lower@example.com',
      'plaintext',
      `ARRAY['user']`,
      /users_password_hash_argon2id_chk/,
    ],
    [
      'an empty role list',
      'lower2@example.com',
      '$argon2id$v=19$m=1,t=1,p=1$a$b',
      `ARRAY[]`,
      /users_roles_not_empty_chk/,
    ],
  ])('the database rejects %s', async (_, mail, hash, roles, constraint) => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO auth.users (email, password_hash, roles, updated_at)
         VALUES ($1, $2, ${roles}::auth.user_role[], now())`,
        `${randomUUID()}-${mail}`,
        hash,
      ),
    ).rejects.toThrow(constraint);
  });

  it('app_writer cannot delete users', async () => {
    const { id } = await users.create({ email: email(), password: 'pw' });
    await expect(
      prisma.$executeRaw`DELETE FROM auth.users WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/permission denied/);
  });
});
