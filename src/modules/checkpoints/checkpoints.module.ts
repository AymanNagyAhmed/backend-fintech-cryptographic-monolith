import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { CheckpointsController } from './checkpoints.controller.js';
import { CheckpointerService } from './checkpointer.service.js';
import { ProofsService } from './proofs.service.js';
import { TsaService } from './tsa.service.js';

@Module({
  imports: [DatabaseModule, CryptoModule, AuditModule],
  controllers: [CheckpointsController],
  providers: [CheckpointerService, ProofsService, TsaService],
  exports: [CheckpointerService, ProofsService, TsaService],
})
export class CheckpointsModule {}
