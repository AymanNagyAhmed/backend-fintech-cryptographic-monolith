import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { CheckpointerService } from './checkpointer.service.js';

@Module({
  imports: [DatabaseModule, CryptoModule],
  providers: [CheckpointerService],
  exports: [CheckpointerService],
})
export class CheckpointsModule {}
