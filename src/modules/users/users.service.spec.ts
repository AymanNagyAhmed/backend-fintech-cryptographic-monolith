import { HttpStatus } from '@nestjs/common';
import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma, UserRole } from '../../generated/prisma/client.js';
import { PasswordHasher } from './password-hasher.js';
import { normalizeEmail, UsersService } from './users.service.js';

const FAST = { memory: 64, passes: 1, parallelism: 1 };

describe('UsersService', () => {
  let user: Record<string, ReturnType<typeof vi.fn>>;
  let hasher: PasswordHasher;
  let service: UsersService;

  beforeEach(() => {
    user = { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() };
    hasher = new PasswordHasher(FAST);
    service = new UsersService({ user } as unknown as PrismaService, hasher);
  });

  it('normalizes emails like the database constraint', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  describe('create', () => {
    it('stores a normalized email, an argon2id hash and the default role', async () => {
      user.create.mockResolvedValue({ id: '1' });
      await service.create({
        email: 'Alice@Example.com',
        password: 'S3cure!pass-123',
      });
      const { data, omit } = user.create.mock.calls[0][0];
      expect(data.email).toBe('alice@example.com');
      expect(data.roles).toEqual([UserRole.user]);
      expect(data.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
      await expect(
        hasher.verify(data.passwordHash, 'S3cure!pass-123'),
      ).resolves.toBe(true);
      expect(omit).toEqual({ passwordHash: true });
    });

    it('uses the transaction client when one is given', async () => {
      const tx = { user: { create: vi.fn().mockResolvedValue({ id: '1' }) } };
      await service.create(
        { email: 'a@b.co', password: 'pw', roles: [UserRole.approver] },
        tx as unknown as Prisma.TransactionClient,
      );
      expect(tx.user.create.mock.calls[0][0].data.roles).toEqual([
        UserRole.approver,
      ]);
      expect(user.create).not.toHaveBeenCalled();
    });

    it('maps a unique violation to EMAIL_TAKEN (409)', async () => {
      user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.create({ email: 'a@b.co', password: 'pw' }),
      ).rejects.toMatchObject({
        code: 'EMAIL_TAKEN',
        statusCode: HttpStatus.CONFLICT,
      });
    });
  });

  describe('verifyCredentials', () => {
    const stored = async (password: string, h = hasher) => ({
      id: 'u1',
      email: 'alice@example.com',
      passwordHash: await h.hash(password),
      status: 'active',
      roles: [UserRole.user],
    });

    it('returns the user without the hash for the right password', async () => {
      user.findUnique.mockResolvedValue(await stored('pw'));
      const result = await service.verifyCredentials(
        ' Alice@example.com',
        'pw',
      );
      expect(user.findUnique).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
      });
      expect(result).toMatchObject({ id: 'u1' });
      expect(result).not.toHaveProperty('passwordHash');
      expect(user.update).not.toHaveBeenCalled();
    });

    it('returns null for a wrong password', async () => {
      user.findUnique.mockResolvedValue(await stored('pw'));
      await expect(service.verifyCredentials('a@b.co', 'nope')).resolves.toBe(
        null,
      );
    });

    it('still runs argon2 for an unknown email', async () => {
      user.findUnique.mockResolvedValue(null);
      const verify = vi.spyOn(hasher, 'verify');
      await expect(service.verifyCredentials('x@y.co', 'pw')).resolves.toBe(
        null,
      );
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0][0]).toMatch(/^\$argon2id\$/);
    });

    it('rehashes when the stored hash uses old parameters', async () => {
      const old = new PasswordHasher({ ...FAST, passes: 2 });
      user.findUnique.mockResolvedValue(await stored('pw', old));
      await service.verifyCredentials('a@b.co', 'pw');
      const { where, data } = user.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'u1' });
      expect(hasher.needsRehash(data.passwordHash)).toBe(false);
    });
  });
});
