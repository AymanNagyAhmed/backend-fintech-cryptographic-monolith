import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
} from '../../common/idempotency/exceptions/idempotency.exceptions.js';
import { assertIdempotencyKey } from '../../common/idempotency/idempotency-key.js';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { BeneficiariesService } from './beneficiaries.service.js';
import { BeneficiaryDto } from './dto/beneficiary.dto.js';
import { ConfirmBeneficiaryDto } from './dto/confirm-beneficiary.dto.js';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto.js';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto.js';
import { WithdrawalDto } from './dto/withdrawal.dto.js';
import { WithdrawalsService } from './withdrawals.service.js';

@ApiTags('Withdrawals')
@ApiBearerAuth()
@ApiExtraModels(BeneficiaryDto, WithdrawalDto)
@ApiFailureResponse(
  HttpStatus.UNAUTHORIZED,
  'Missing, invalid or expired access token',
)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(
    private readonly beneficiaries: BeneficiariesService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  @Post()
  @ResponseMessage('Withdrawal completed')
  @ApiOperation({
    operationId: 'withdrawals.create',
    summary:
      'Pay an active beneficiary. A fresh TOTP code is required on every call',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'A new UUID per payout, reused on every retry of it. Same key + same body replays the first response.',
    schema: {
      type: 'string',
      example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70',
    },
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(WithdrawalDto) }, HttpStatus.CREATED)
  @ApiFailureResponse(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED or INVALID_IDEMPOTENCY_KEY',
  )
  @ApiFailureResponse(
    HttpStatus.NOT_FOUND,
    'WALLET_NOT_FOUND or BENEFICIARY_NOT_FOUND',
  )
  @ApiFailureResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'INVALID_TOTP, BENEFICIARY_NOT_ACTIVE, INSUFFICIENT_FUNDS, CURRENCY_MISMATCH, ACCOUNT_FROZEN, ACCOUNT_CLOSED or IDEMPOTENCY_KEY_REUSED',
  )
  async payout(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateWithdrawalDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WithdrawalDto> {
    assertIdempotencyKey(idempotencyKey);
    const result = await this.withdrawals.payout(user.id, idempotencyKey, dto);
    res.status(result.statusCode);
    if (result.replayed) res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return result.body;
  }

  @Post('beneficiaries')
  @ResponseMessage('Beneficiary added to allow-list')
  @ApiOperation({
    operationId: 'withdrawals.beneficiaryCreate',
    summary:
      'Add a withdrawal destination to the allow-list (inactive until 2FA confirm + delay)',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(BeneficiaryDto) }, HttpStatus.CREATED)
  @ApiFailureResponse(HttpStatus.CONFLICT, 'BENEFICIARY_DUPLICATE')
  @ApiFailureResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'UNSUPPORTED_CURRENCY or VALIDATION_FAILED',
  )
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBeneficiaryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BeneficiaryDto> {
    const body = await this.beneficiaries.create(user.id, dto);
    res.status(HttpStatus.CREATED);
    return body;
  }

  @Get('beneficiaries')
  @ResponseMessage('OK')
  @ApiOperation({
    operationId: 'withdrawals.beneficiaryList',
    summary: 'List allow-listed withdrawal destinations for the caller',
  })
  @ApiOkEnvelope({
    type: 'array',
    items: { $ref: getSchemaPath(BeneficiaryDto) },
  })
  list(@CurrentUser() user: AuthUser): Promise<BeneficiaryDto[]> {
    return this.beneficiaries.list(user.id);
  }

  @Post('beneficiaries/:id/confirm')
  @ResponseMessage('Beneficiary confirmed; activation delay started')
  @ApiOperation({
    operationId: 'withdrawals.beneficiaryConfirm',
    summary:
      'Confirm an allow-list entry with TOTP; becomes active after BENEFICIARY_ACTIVATION_DELAY_HOURS',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(BeneficiaryDto) })
  @ApiFailureResponse(HttpStatus.NOT_FOUND, 'BENEFICIARY_NOT_FOUND')
  @ApiFailureResponse(HttpStatus.CONFLICT, 'BENEFICIARY_NOT_PENDING')
  @ApiFailureResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'TOTP_REQUIRED or INVALID_TOTP',
  )
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmBeneficiaryDto,
  ): Promise<BeneficiaryDto> {
    return this.beneficiaries.confirm(user.id, id, dto.totpCode);
  }
}
