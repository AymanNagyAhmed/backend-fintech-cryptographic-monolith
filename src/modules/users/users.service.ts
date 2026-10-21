import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DomainException } from '../../common/exceptions/domain.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, UserRole, type User } from '../../generated/prisma/client.js';
import { PasswordHasher } from './password-hasher.js';

/** A user without the password hash; the only shape that leaves this module. */
export type UserView = Omit<User, 'passwordHash'>;

export interface CreateUserInput {
  email: string;
  password: string;
  roles?: UserRole[];
}

const UNIQUE_VIOLATION = 'P2002';
const OMIT_HASH = { passwordHash: true } as const;

/** Same rule as the users_email_normalized_chk constraint. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class UsersService {
  // Hash of a random password, verified for unknown emails so both paths cost the same
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  async create(
    input: CreateUserInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<UserView> {
    // Hash before any transaction starts: it is slow and needs no database
    const passwordHash = await this.hasher.hash(input.password);
    try {
      return await tx.user.create({
        data: {
          email: normalizeEmail(input.email),
          passwordHash,
          roles: input.roles?.length ? input.roles : [UserRole.user],
        },
        omit: OMIT_HASH,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === UNIQUE_VIOLATION
      )
        throw new DomainException(
          'EMAIL_TAKEN',
          'Email is already registered',
          HttpStatus.CONFLICT,
        );
      throw e;
    }
  }

  findById(id: string): Promise<UserView | null> {
    return this.prisma.user.findUnique({ where: { id }, omit: OMIT_HASH });
  }

  /** Roles stored for this user, or null when the row is gone. */
  async rolesOf(id: string): Promise<UserRole[] | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: { roles: true },
    });
    return row?.roles ?? null;
  }

  findByEmail(email: string): Promise<UserView | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      omit: OMIT_HASH,
    });
  }

  /**
   * The user when the password matches, otherwise null (unknown email or wrong password,
   * not distinguishable by timing). Status is not checked here: callers decide what a
   * locked or disabled account may do. Rehashes when the argon2 parameters changed.
   */
  async verifyCredentials(
    email: string,
    password: string,
  ): Promise<UserView | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    if (!user) {
      await this.hasher.verify(await this.getDummyHash(), password);
      return null;
    }
    if (!(await this.hasher.verify(user.passwordHash, password))) return null;

    const { passwordHash, ...view } = user;
    if (this.hasher.needsRehash(passwordHash))
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.hasher.hash(password) },
      });
    return view;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash(randomBytes(32).toString('base64'));
    return this.dummyHash;
  }
}
