import { Controller, Get, Query } from '@nestjs/common';
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
import { ProofQueryDto } from './dto/proof-query.dto.js';
import { ReservesProofDto } from './dto/reserves-proof.dto.js';
import { ReservesService } from './reserves.service.js';

@ApiTags('Reserves')
@ApiBearerAuth()
@ApiExtraModels(ReservesProofDto)
@Controller('reserves')
export class ReservesController {
  constructor(private readonly reserves: ReservesService) {}

  @Get('proof/me')
  @ResponseMessage('OK')
  @ApiOperation({
    operationId: 'reserves.proofMe',
    summary:
      'Merkle-sum inclusion proof for the caller in the latest reserves snapshot',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(ReservesProofDto) })
  @ApiFailureResponse(404, 'RESERVES_SNAPSHOT_NOT_FOUND or RESERVES_LEAF_NOT_FOUND')
  proofMe(
    @CurrentUser() user: AuthUser,
    @Query() query: ProofQueryDto,
  ): Promise<ReservesProofDto> {
    return this.reserves.proofForUser(user.id, query.currency);
  }
}
