import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { BeneficiariesService } from './beneficiaries.service.js';
import { WithdrawalsController } from './withdrawals.controller.js';
import { WithdrawalsService } from './withdrawals.service.js';

// Owns withdrawals.beneficiaries + withdrawals.outbox; wallets/ledger later (A-B13.2+)
@Module({
  imports: [AuthModule, OutboxModule],
  controllers: [WithdrawalsController],
  providers: [BeneficiariesService, WithdrawalsService],
  exports: [BeneficiariesService, WithdrawalsService],
})
export class WithdrawalsModule {}
