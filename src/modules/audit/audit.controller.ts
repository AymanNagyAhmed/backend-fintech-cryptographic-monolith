import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiQuery,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AuditAccessService } from './audit-access.service.js';
import { VerifyReportDto } from './dto/verify-report.dto.js';
import { VerifyService } from './verify.service.js';

@ApiTags('Audit')
@ApiBearerAuth()
@ApiExtraModels(VerifyReportDto)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly verifyService: VerifyService,
    private readonly access: AuditAccessService,
  ) {}

  @Get('verify')
  @Roles('compliance', 'admin')
  @ResponseMessage('Audit chain verification complete')
  @ApiOperation({
    operationId: 'audit.verify',
    summary: 'Verify hash chains (gaps, duplicates, broken hashes)',
  })
  @ApiQuery({
    name: 'partition',
    required: false,
    description: 'Limit to one partition_key',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(VerifyReportDto) })
  @ApiFailureResponse(401, 'Missing or invalid access token')
  @ApiFailureResponse(403, 'Requires compliance or admin with MFA')
  async verify(
    @CurrentUser() user: AuthUser,
    @Query('partition') partition?: string,
  ): Promise<VerifyReportDto> {
    const report = await this.verifyService.verify(
      partition && partition.length > 0 ? partition : undefined,
    );
    await this.access.record(
      user.id,
      'verify',
      partition && partition.length > 0 ? `partition=${partition}` : 'all',
    );
    return report;
  }
}
