import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { PrivacyService } from './privacy.service.js';
import { SubjectKeysService } from './subject-keys.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [SubjectKeysService, PrivacyService],
  exports: [SubjectKeysService, PrivacyService],
})
export class PrivacyModule {}
