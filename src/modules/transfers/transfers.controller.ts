import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import { IDEMPOTENCY_KEY_HEADER } from '../../common/idempotency/exceptions/idempotency.exceptions.js';
import { assertIdempotencyKey } from '../../common/idempotency/idempotency-key.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { TransferDto } from './dto/transfer.dto.js';
import { TransfersService } from './transfers.service.js';

/** Set on a response that replays the stored result of an earlier request with the same key. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

@ApiTags('Transfers')
@ApiBearerAuth()
@ApiExtraModels(TransferDto)
@ApiFailureResponse(
  HttpStatus.UNAUTHORIZED,
  'Missing, invalid or expired access token',
)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @ResponseMessage('Transfer completed')
  @ApiOperation({
    operationId: 'transfers.create',
    summary:
      "Move money from one of the caller's wallets to another wallet (idempotent)",
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'A new UUID per transfer, reused on every retry of it. Same key + same body replays the first response (header Idempotent-Replayed: true); same key + other body = 422.',
    schema: {
      type: 'string',
      example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70',
    },
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(TransferDto) }, HttpStatus.CREATED)
  @ApiFailureResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED or INVALID_IDEMPOTENCY_KEY (missing or malformed header)',
  )
  @ApiFailureResponse(
    HttpStatus.NOT_FOUND,
    'WALLET_NOT_FOUND (also for a source wallet of another user)',
  )
  @ApiFailureResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'INSUFFICIENT_FUNDS, CURRENCY_MISMATCH, UNSUPPORTED_CURRENCY, INVALID_AMOUNT, INVALID_TRANSFER, ACCOUNT_NOT_ACTIVE or IDEMPOTENCY_KEY_REUSED',
  )
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateTransferDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferDto> {
    assertIdempotencyKey(idempotencyKey);
    const result = await this.transfers.create(user.id, idempotencyKey, dto);
    res.status(result.statusCode);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }
}
