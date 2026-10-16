import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ComplianceService } from './compliance.service.js';
import { ExportService } from './export.service.js';

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly exports: ExportService,
  ) {}

  @Post('exports')
  @Roles('compliance', 'admin')
  @ResponseMessage('Regulator export created')
  @ApiOperation({
    operationId: 'compliance.export',
    summary: 'Build a ZIP of records, proofs, STHs, TSA tokens, public keys',
  })
  @ApiOkEnvelope({ type: 'object' })
  @ApiFailureResponse(401, 'Missing or invalid access token')
  @ApiFailureResponse(403, 'Requires compliance or admin with MFA')
  createExport(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      partitionKey?: string;
      from?: string;
      to?: string;
      limit?: number;
    },
  ) {
    return this.exports.createExport(user.id, body ?? {});
  }

  @Get('search')
  @Roles('compliance', 'admin')
  @ResponseMessage('Compliance search results')
  @ApiOperation({
    operationId: 'compliance.search',
    summary: 'Search audit events (partition, actor, type, time); access is audited',
  })
  @ApiQuery({ name: 'partitionKey', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'subjectRef', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO datetime' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO datetime' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkEnvelope({ type: 'object' })
  @ApiFailureResponse(401, 'Missing or invalid access token')
  @ApiFailureResponse(403, 'Requires compliance or admin with MFA')
  search(
    @CurrentUser() user: AuthUser,
    @Query('partitionKey') partitionKey?: string,
    @Query('type') type?: string,
    @Query('subjectRef') subjectRef?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.compliance.search(user.id, {
      ...(partitionKey !== undefined ? { partitionKey } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(subjectRef !== undefined ? { subjectRef } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
  }
}
