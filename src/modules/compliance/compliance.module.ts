import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ComplianceController } from './compliance.controller.js';
import { ComplianceService } from './compliance.service.js';
import { ExportWormService } from './export-worm.service.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [DatabaseModule, AuditModule, CryptoModule],
  controllers: [ComplianceController],
  providers: [ComplianceService, ExportService, ExportWormService],
  exports: [ComplianceService, ExportService],
})
export class ComplianceModule {}
