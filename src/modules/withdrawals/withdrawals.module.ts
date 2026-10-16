import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { BeneficiariesService } from './beneficiaries.service.js';
import { WithdrawalPolicyService } from './withdrawal-policy.service.js';
import { WithdrawalsController } from './withdrawals.controller.js';
import { WithdrawalsService } from './withdrawals.service.js';

// Owns withdrawals.beneficiaries + withdrawals.outbox; wallets/ledger later (A-B13.3+)
@Module({
  imports: [AuthModule, OutboxModule],
  controllers: [WithdrawalsController],
  providers: [
    BeneficiariesService,
    WithdrawalPolicyService,
    WithdrawalsService,
  ],
  exports: [BeneficiariesService, WithdrawalPolicyService, WithdrawalsService],
})
export class WithdrawalsModule {}
