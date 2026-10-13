import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import { DomainException } from '../../common/exceptions/domain.exception.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import { IP_THROTTLER, RATE_LIMITS } from '../../config/throttler.config.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import {
  ListWalletsQueryDto,
  WALLET_PAGE_DEFAULT,
} from './dto/list-wallets-query.dto.js';
import { UpdateWalletDto } from './dto/update-wallet.dto.js';
import { WalletPageDto } from './dto/wallet-page.dto.js';
import { WalletDto } from './dto/wallet.dto.js';
import { WalletsService } from './wallets.service.js';

const ref = (model: new () => object) => ({ $ref: getSchemaPath(model) });

// Same envelope as the global ValidationPipe, so clients see one code for bad input
const walletIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new DomainException(
      'VALIDATION_FAILED',
      'The request contains invalid fields.',
      HttpStatus.BAD_REQUEST,
      [{ field: 'id', issue: 'id must be a UUID' }],
    ),
});

@ApiTags('Wallets')
@ApiBearerAuth()
@ApiExtraModels(WalletDto, WalletPageDto)
@ApiFailureResponse(
  HttpStatus.UNAUTHORIZED,
  'Missing, invalid or expired access token',
)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  @Throttle({ [IP_THROTTLER]: RATE_LIMITS.walletCreate })
  @ResponseMessage('Wallet created')
  @ApiOperation({
    operationId: 'wallets.create',
    summary: 'Open a wallet in a currency (several per currency allowed)',
  })
  @ApiOkEnvelope(ref(WalletDto), HttpStatus.CREATED)
  @ApiFailureResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED')
  @ApiFailureResponse(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'UNSUPPORTED_CURRENCY or INVALID_LABEL',
  )
  @ApiFailureResponse(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY_REQUESTS')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWalletDto,
  ): Promise<WalletDto> {
    return this.wallets.open(user.id, dto);
  }

  @Get()
  @ApiOperation({
    operationId: 'wallets.list',
    summary: "The caller's wallets with balances, oldest first (cursor pages)",
  })
  @ApiOkEnvelope(ref(WalletPageDto))
  @ApiFailureResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListWalletsQueryDto,
  ): Promise<WalletPageDto> {
    return this.wallets.listPage(user.id, {
      cursor: query.cursor,
      limit: query.limit ?? WALLET_PAGE_DEFAULT,
    });
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'wallets.get',
    summary: "One of the caller's wallets with its balance",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkEnvelope(ref(WalletDto))
  @ApiFailureResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED')
  @ApiFailureResponse(
    HttpStatus.NOT_FOUND,
    "WALLET_NOT_FOUND (also for another user's wallet)",
  )
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', walletIdPipe) id: string,
  ): Promise<WalletDto> {
    return this.wallets.getOwned(id, user.id);
  }

  @Patch(':id')
  @ResponseMessage('Wallet updated')
  @ApiOperation({
    operationId: 'wallets.rename',
    summary: "Set or clear (null) the label of one of the caller's wallets",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkEnvelope(ref(WalletDto))
  @ApiFailureResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED')
  @ApiFailureResponse(
    HttpStatus.NOT_FOUND,
    "WALLET_NOT_FOUND (also for another user's wallet)",
  )
  @ApiFailureResponse(HttpStatus.CONFLICT, 'WALLET_CLOSED')
  @ApiFailureResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_LABEL')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', walletIdPipe) id: string,
    @Body() dto: UpdateWalletDto,
  ): Promise<WalletDto> {
    return this.wallets.renameOwned(id, user.id, dto.label);
  }
}
