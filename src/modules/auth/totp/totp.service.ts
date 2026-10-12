import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { DomainException } from '../../../common/exceptions/domain.exception.js';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { SecretBox } from './secret-box.js';
import {
  base32Encode,
  matchTotpStep,
  otpauthUri,
  TOTP_SECRET_BYTES,
} from './totp.js';

export const TOTP_ISSUER = 'Fintech';

const conflict = (code: string, message: string) =>
  new DomainException(code, message, HttpStatus.CONFLICT);

@Injectable()
export class TotpService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.box = new SecretBox(
      config.get('TOTP_ENCRYPTION_KEY', { infer: true }),
    );
  }

  async isEnabled(userId: string): Promise<boolean> {
    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId },
      select: { enabledAt: true },
    });
    return Boolean(cred?.enabledAt);
  }

  /**
   * Starts enrollment with a new secret (replacing a pending one). The secret is shown once;
   * an enabled credential cannot be replaced by the user (reset is an admin action).
   */
  async setup(
    userId: string,
    email: string,
  ): Promise<{ otpauthUri: string; secret: string }> {
    if (await this.isEnabled(userId))
      throw conflict('TOTP_ALREADY_ENABLED', 'TOTP is already enabled.');
    const secret = randomBytes(TOTP_SECRET_BYTES);
    const secretEnc = this.box.seal(secret, userId);
    await this.prisma.totpCredential.upsert({
      where: { userId },
      create: { userId, secretEnc },
      update: { secretEnc, lastStep: null },
    });
    return {
      otpauthUri: otpauthUri(secret, email, TOTP_ISSUER),
      secret: base32Encode(secret),
    };
  }

  /** Confirms enrollment with a first code from the authenticator app. */
  async enable(userId: string, code: string): Promise<void> {
    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId },
    });
    if (!cred)
      throw conflict('TOTP_NOT_SET_UP', 'Call POST /v1/auth/totp/setup first.');
    if (cred.enabledAt)
      throw conflict('TOTP_ALREADY_ENABLED', 'TOTP is already enabled.');
    const step = matchTotpStep(this.box.open(cred.secretEnc, userId), code);
    const claimed =
      step !== null &&
      (await this.prisma.totpCredential.updateMany({
        // secretEnc: a concurrent setup must not be enabled with the old secret's code
        where: { userId, enabledAt: null, secretEnc: cred.secretEnc },
        data: { enabledAt: new Date(), lastStep: step },
      }));
    if (!claimed || claimed.count !== 1)
      throw new DomainException(
        'INVALID_TOTP',
        'The TOTP code is wrong or expired.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
  }

  /**
   * True when `code` is valid for an enabled credential and newer than the last accepted
   * one. Each code works once, also under concurrent requests (conditional update).
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId },
    });
    if (!cred?.enabledAt) return false;
    const step = matchTotpStep(this.box.open(cred.secretEnc, userId), code);
    if (step === null) return false;
    const claimed = await this.prisma.totpCredential.updateMany({
      where: {
        userId,
        enabledAt: { not: null },
        OR: [{ lastStep: null }, { lastStep: { lt: step } }],
      },
      data: { lastStep: step },
    });
    return claimed.count === 1;
  }
}
