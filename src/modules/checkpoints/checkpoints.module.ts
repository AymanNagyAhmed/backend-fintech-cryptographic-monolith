import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { CheckpointerService } from './checkpointer.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [CheckpointerService],
  exports: [CheckpointerService],
})
export class CheckpointsModule {}
