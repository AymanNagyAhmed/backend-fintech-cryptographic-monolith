import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { BeneficiariesService } from './beneficiaries.service.js';
import { CustodySignerService } from './custody-signer.service.js';
import { HotColdService } from './hot-cold.service.js';
import { WithdrawalPolicyService } from './withdrawal-policy.service.js';
import { WithdrawalsController } from './withdrawals.controller.js';
import { WithdrawalsService } from './withdrawals.service.js';

// Owns withdrawals.beneficiaries + withdrawals.outbox
@Module({
  imports: [AuthModule, OutboxModule, CryptoModule],
  controllers: [WithdrawalsController],
  providers: [
    BeneficiariesService,
    WithdrawalPolicyService,
    CustodySignerService,
    HotColdService,
    WithdrawalsService,
  ],
  exports: [
    BeneficiariesService,
    WithdrawalPolicyService,
    CustodySignerService,
    HotColdService,
    WithdrawalsService,
  ],
})
export class WithdrawalsModule {}
