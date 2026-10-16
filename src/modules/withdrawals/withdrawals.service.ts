import { Injectable } from '@nestjs/common';
import { BeneficiariesService } from './beneficiaries.service.js';

/**
 * Withdrawal orchestration (policy, custody sign, ledger) lands in A-B13.2+.
 * This stub keeps nest g scaffolding and exports a stable service for later steps.
 */
@Injectable()
export class WithdrawalsService {
  constructor(private readonly beneficiaries: BeneficiariesService) {}

  /** Ensures the destination is on the allow-list and past the activation delay. */
  requireActiveBeneficiary(ownerUserId: string, beneficiaryId: string) {
    return this.beneficiaries.requireActive(ownerUserId, beneficiaryId);
  }
}
