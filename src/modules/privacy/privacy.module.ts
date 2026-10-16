import { Module } from '@nestjs/common';
import { SubjectKeysService } from './subject-keys.service.js';

@Module({
  providers: [SubjectKeysService],
  exports: [SubjectKeysService],
})
export class PrivacyModule {}
