import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
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

@ApiTags('Withdrawals')
@ApiBearerAuth()
@ApiExtraModels(BeneficiaryDto)
@ApiFailureResponse(
  HttpStatus.UNAUTHORIZED,
  'Missing, invalid or expired access token',
)
@Controller('withdrawals')
export class WithdrawalsController {
  constructor(private readonly beneficiaries: BeneficiariesService) {}

  @Post('beneficiaries')
  @ResponseMessage('Beneficiary added to allow-list')
  @ApiOperation({
    operationId: 'withdrawals.beneficiaryCreate',
    summary:
      'Add a withdrawal destination to the allow-list (inactive until 2FA confirm + delay)',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(BeneficiaryDto) }, HttpStatus.CREATED)
  @ApiFailureResponse(
    HttpStatus.CONFLICT,
    'BENEFICIARY_DUPLICATE',
  )
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
  @ApiFailureResponse(
    HttpStatus.CONFLICT,
    'BENEFICIARY_NOT_PENDING',
  )
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
