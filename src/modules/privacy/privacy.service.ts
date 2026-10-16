import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { SubjectKeysService } from './subject-keys.service.js';

export interface EncryptedPii {
  ciphertext: string;
  ciphertextHash: string;
}

/**
 * Encrypts PII under the subject Transit key and stores ciphertext in privacy.subject_pii.
 * Audit payloads should carry only subjectRef + ciphertextHash (A-B11.2 / 2.8).
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: SubjectKeysService,
  ) {}

  static hashCiphertext(ciphertext: string): string {
    return createHash('sha256').update(ciphertext, 'utf8').digest('hex');
  }

  async storeField(
    subjectRef: string,
    field: string,
    plaintext: string,
  ): Promise<EncryptedPii> {
    const ciphertext = await this.keys.encrypt(subjectRef, plaintext);
    const ciphertextHash = PrivacyService.hashCiphertext(ciphertext);
    await this.prisma.subjectPii.upsert({
      where: { subjectRef_field: { subjectRef, field } },
      create: { subjectRef, field, ciphertext, ciphertextHash },
      update: { ciphertext, ciphertextHash },
    });
    return { ciphertext, ciphertextHash };
  }

  async readField(
    subjectRef: string,
    field: string,
  ): Promise<string | null> {
    const row = await this.prisma.subjectPii.findUnique({
      where: { subjectRef_field: { subjectRef, field } },
    });
    if (!row) return null;
    return this.keys.decrypt(subjectRef, row.ciphertext);
  }
}
