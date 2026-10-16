import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
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
import { AuditAccessService } from '../audit/audit-access.service.js';
import { ConsistencyProofDto } from './dto/consistency-proof.dto.js';
import { InclusionProofDto } from './dto/inclusion-proof.dto.js';
import { ProofsService } from './proofs.service.js';

@ApiTags('Audit')
@ApiBearerAuth()
@ApiExtraModels(InclusionProofDto, ConsistencyProofDto)
@Controller('audit')
export class CheckpointsController {
  constructor(
    private readonly proofs: ProofsService,
    private readonly access: AuditAccessService,
  ) {}

  @Get('proof/:eventId')
  @Roles('compliance', 'admin')
  @ResponseMessage('Inclusion proof')
  @ApiOperation({
    operationId: 'audit.proof',
    summary: 'RFC 6962 inclusion proof for an audit event against the latest STH',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(InclusionProofDto) })
  @ApiFailureResponse(401, 'Missing or invalid access token')
  @ApiFailureResponse(403, 'Requires compliance or admin with MFA')
  @ApiFailureResponse(404, 'Event or STH not found')
  async proof(
    @CurrentUser() user: AuthUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<InclusionProofDto> {
    const result = await this.proofs.inclusionProofForEvent(eventId);
    await this.access.record(user.id, 'proof', `eventId=${eventId}`);
    return result;
  }

  @Get('consistency')
  @Roles('compliance', 'admin')
  @ResponseMessage('Consistency proof')
  @ApiOperation({
    operationId: 'audit.consistency',
    summary: 'RFC 6962 consistency proof between two published tree sizes',
  })
  @ApiQuery({ name: 'from', type: Number, required: true })
  @ApiQuery({ name: 'to', type: Number, required: true })
  @ApiOkEnvelope({ $ref: getSchemaPath(ConsistencyProofDto) })
  @ApiFailureResponse(400, 'Invalid from/to')
  @ApiFailureResponse(401, 'Missing or invalid access token')
  @ApiFailureResponse(403, 'Requires compliance or admin with MFA')
  @ApiFailureResponse(404, 'STH or leaves not found')
  async consistency(
    @CurrentUser() user: AuthUser,
    @Query('from', ParseIntPipe) from: number,
    @Query('to', ParseIntPipe) to: number,
  ): Promise<ConsistencyProofDto> {
    const result = await this.proofs.consistencyProofBetween(from, to);
    await this.access.record(user.id, 'consistency', `from=${from}&to=${to}`);
    return result;
  }
}
