import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiProperty,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import { CURRENCIES } from '../../common/money/currency.js';
import { IsDecimalString } from '../../common/money/decorators/is-decimal-string.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ProofQueryDto } from './dto/proof-query.dto.js';
import { ReservesProofDto } from './dto/reserves-proof.dto.js';
import { ReservesService } from './reserves.service.js';

class CompareReservesDto {
  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  @IsString()
  @IsIn([...CURRENCIES])
  currency: string;

  @ApiProperty({
    example: '10000.00',
    description: 'Custodian statement or on-chain fixture total (decimal string)',
  })
  @IsDecimalString()
  reserves: string;
}

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

  @Post('compare')
  @Roles('compliance', 'admin')
  @ResponseMessage('Reserves cover liabilities')
  @ApiOperation({
    operationId: 'reserves.compare',
    summary:
      'Compare published liabilities to a custodian/on-chain reserves figure',
  })
  @ApiOkEnvelope({ type: 'object' })
  @ApiFailureResponse(404, 'RESERVES_SNAPSHOT_NOT_FOUND')
  @ApiFailureResponse(422, 'RESERVES_UNDER_COLLATERALIZED')
  compare(@Body() dto: CompareReservesDto) {
    return this.reserves.compareToReserves(dto.currency, dto.reserves);
  }
}
