import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { CheckpointsController } from './checkpoints.controller.js';
import { CheckpointerService } from './checkpointer.service.js';
import { ProofsService } from './proofs.service.js';
import { SthService } from './sth.service.js';
import { TsaService } from './tsa.service.js';
import { WitnessService } from './witness.service.js';
import { WormService } from './worm.service.js';

@Module({
  imports: [DatabaseModule, CryptoModule, AuditModule],
  controllers: [CheckpointsController],
  providers: [
    CheckpointerService,
    ProofsService,
    SthService,
    TsaService,
    WormService,
    WitnessService,
  ],
  exports: [
    CheckpointerService,
    ProofsService,
    SthService,
    TsaService,
    WormService,
    WitnessService,
  ],
})
export class CheckpointsModule {}
