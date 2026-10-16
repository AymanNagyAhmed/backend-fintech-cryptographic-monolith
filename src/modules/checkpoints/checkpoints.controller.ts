import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
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
import { InclusionProofDto } from './dto/inclusion-proof.dto.js';
import { ProofsService } from './proofs.service.js';

@ApiTags('Audit')
@ApiBearerAuth()
@ApiExtraModels(InclusionProofDto)
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
}
