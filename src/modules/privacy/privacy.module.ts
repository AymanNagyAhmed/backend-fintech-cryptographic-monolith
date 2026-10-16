import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ErasureService } from './erasure.service.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';
import { SubjectKeysService } from './subject-keys.service.js';

@Module({
  imports: [DatabaseModule, OutboxModule],
  controllers: [PrivacyController],
  providers: [SubjectKeysService, PrivacyService, ErasureService],
  exports: [SubjectKeysService, PrivacyService, ErasureService],
})
export class PrivacyModule {}
