import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRequestId } from '../../common/request-context.js';
import { isCurrency } from '../../common/money/currency.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { TotpService } from '../auth/totp/totp.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { addressChecksumOk } from './address-checksum.js';
import type { BeneficiaryDto } from './dto/beneficiary.dto.js';
import type { CreateBeneficiaryDto } from './dto/create-beneficiary.dto.js';
import {
  beneficiaryDuplicate,
  beneficiaryNotActive,
  beneficiaryNotFound,
  beneficiaryNotPending,
  invalidAddress,
  invalidTotp,
  totpRequired,
  unsupportedCurrency,
} from './exceptions/withdrawal.exceptions.js';

type BeneficiaryRow = {
  id: string;
  ownerUserId: string;
  label: string;
  currency: string;
  address: string;
  network: string;
  status: string;
  confirmedAt: Date | null;
  activeAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class BeneficiariesService {
  private readonly delayHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
    private readonly outbox: OutboxService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.delayHours = config.get('BENEFICIARY_ACTIVATION_DELAY_HOURS', {
      infer: true,
    });
  }

  async create(
    ownerUserId: string,
    dto: CreateBeneficiaryDto,
  ): Promise<BeneficiaryDto> {
    if (!isCurrency(dto.currency)) throw unsupportedCurrency(dto.currency);
    const address = dto.address.trim();
    const network = dto.network.trim().toLowerCase();
    if (!addressChecksumOk(network, address)) throw invalidAddress();
    try {
      const row = await this.prisma.beneficiary.create({
        data: {
          ownerUserId,
          label: dto.label.trim(),
          currency: dto.currency,
          address,
          network,
          status: 'pending_confirmation',
        },
      });
      return toDto(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw beneficiaryDuplicate();
      throw e;
    }
  }

  async list(ownerUserId: string): Promise<BeneficiaryDto[]> {
    const rows = await this.prisma.beneficiary.findMany({
      where: { ownerUserId },
      orderBy: { id: 'asc' },
    });
    return rows.map(toDto);
  }

  async confirm(
    ownerUserId: string,
    id: string,
    totpCode: string,
  ): Promise<BeneficiaryDto> {
    if (!(await this.totp.isEnabled(ownerUserId))) throw totpRequired();
    if (!(await this.totp.verify(ownerUserId, totpCode))) throw invalidTotp();

    const existing = await this.prisma.beneficiary.findFirst({
      where: { id, ownerUserId },
    });
    if (!existing) throw beneficiaryNotFound();
    if (existing.status !== 'pending_confirmation')
      throw beneficiaryNotPending(existing.status);

    const confirmedAt = new Date();
    const activeAt = new Date(
      confirmedAt.getTime() + this.delayHours * 60 * 60 * 1000,
    );

    const row = await this.prisma.withTx(async (tx) => {
      const updated = await tx.beneficiary.update({
        where: { id },
        data: {
          status: 'confirmed',
          confirmedAt,
          activeAt,
        },
      });
      const requestId = getRequestId();
      await this.outbox.enqueue(tx, 'withdrawals', {
        type: 'beneficiary.confirmed',
        schemaVersion: 1,
        occurredAt: confirmedAt.toISOString(),
        actor: { subjectRef: ownerUserId },
        ...(requestId !== undefined ? { requestId } : {}),
        partitionKey: ownerUserId,
        beneficiaryId: id,
        currency: updated.currency,
        network: updated.network,
        activeAt: activeAt.toISOString(),
      });
      return updated;
    });
    return toDto(row);
  }

  /** True when the owner may withdraw to this beneficiary right now. */
  async requireActive(
    ownerUserId: string,
    beneficiaryId: string,
  ): Promise<BeneficiaryRow> {
    const row = await this.prisma.beneficiary.findFirst({
      where: { id: beneficiaryId, ownerUserId },
    });
    if (!row) throw beneficiaryNotFound();
    if (!isActive(row)) throw beneficiaryNotActive();
    return row;
  }
}

export function isActive(
  row: Pick<BeneficiaryRow, 'status' | 'activeAt' | 'revokedAt'>,
  now: Date = new Date(),
): boolean {
  return (
    row.status === 'confirmed' &&
    row.revokedAt == null &&
    row.activeAt != null &&
    row.activeAt.getTime() <= now.getTime()
  );
}

function toDto(row: BeneficiaryRow): BeneficiaryDto {
  return {
    id: row.id,
    label: row.label,
    currency: row.currency,
    address: row.address,
    network: row.network,
    status: row.status,
    active: isActive(row),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    activeAt: row.activeAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
