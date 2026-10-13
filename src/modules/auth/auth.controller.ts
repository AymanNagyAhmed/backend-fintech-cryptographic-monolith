import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import { ThrottleByAccount } from '../../common/throttler/decorators/throttle-by-account.decorator.js';
import { IP_THROTTLER, RATE_LIMITS } from '../../config/throttler.config.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutResultDto } from './dto/logout-result.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { TokenPairDto } from './dto/token-pair.dto.js';
import { TotpCodeDto } from './dto/totp-code.dto.js';
import { TotpEnabledDto } from './dto/totp-enabled.dto.js';
import { TotpSetupDto } from './dto/totp-setup.dto.js';
import { UserProfileDto } from './dto/user-profile.dto.js';
import { TotpService } from './totp/totp.service.js';

const ref = (model: new () => object) => ({ $ref: getSchemaPath(model) });

@ApiTags('Auth')
@ApiExtraModels(
  TokenPairDto,
  UserProfileDto,
  LogoutResultDto,
  TotpSetupDto,
  TotpEnabledDto,
)
@ApiFailureResponse(
  HttpStatus.TOO_MANY_REQUESTS,
  'TOO_MANY_REQUESTS (per IP, and per account on login / register); see Retry-After',
)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly totp: TotpService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ [IP_THROTTLER]: RATE_LIMITS.register })
  @ThrottleByAccount()
  @ResponseMessage('User registered')
  @ApiOperation({
    operationId: 'auth.register',
    summary: 'Create a user account (role `user`)',
  })
  @ApiOkEnvelope(ref(UserProfileDto), HttpStatus.CREATED)
  @ApiFailureResponse(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED')
  @ApiFailureResponse(HttpStatus.CONFLICT, 'EMAIL_TAKEN')
  register(@Body() dto: RegisterDto): Promise<UserProfileDto> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @Throttle({ [IP_THROTTLER]: RATE_LIMITS.login })
  @ThrottleByAccount()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged in')
  @ApiOperation({
    operationId: 'auth.login',
    summary: 'Exchange email, password (and TOTP code once enabled) for tokens',
  })
  @ApiOkEnvelope(ref(TokenPairDto))
  @ApiFailureResponse(
    HttpStatus.UNAUTHORIZED,
    'INVALID_CREDENTIALS, TOTP_REQUIRED or INVALID_TOTP',
  )
  @ApiFailureResponse(HttpStatus.FORBIDDEN, 'ACCOUNT_INACTIVE')
  login(@Body() dto: LoginDto): Promise<TokenPairDto> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @Throttle({ [IP_THROTTLER]: RATE_LIMITS.refresh })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Tokens refreshed')
  @ApiOperation({
    operationId: 'auth.refresh',
    summary: 'Rotate the refresh token and get a new access token',
  })
  @ApiOkEnvelope(ref(TokenPairDto))
  @ApiFailureResponse(
    HttpStatus.UNAUTHORIZED,
    'INVALID_REFRESH_TOKEN, or REFRESH_TOKEN_REUSED (the session is revoked)',
  )
  @ApiFailureResponse(HttpStatus.FORBIDDEN, 'ACCOUNT_INACTIVE')
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenPairDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @Throttle({ [IP_THROTTLER]: RATE_LIMITS.logout })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged out')
  @ApiOperation({
    operationId: 'auth.logout',
    summary: 'Revoke the session of a refresh token (always succeeds)',
  })
  @ApiOkEnvelope(ref(LogoutResultDto))
  async logout(@Body() dto: RefreshTokenDto): Promise<LogoutResultDto> {
    await this.auth.logout(dto.refreshToken);
    return { loggedOut: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'auth.me', summary: 'The current user' })
  @ApiOkEnvelope(ref(UserProfileDto))
  @ApiFailureResponse(
    HttpStatus.UNAUTHORIZED,
    'Missing, invalid or expired access token',
  )
  me(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.auth.me(user.id);
  }

  @Post('totp/setup')
  @Throttle({ [IP_THROTTLER]: RATE_LIMITS.totp })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Scan the QR code, then confirm with a code')
  @ApiOperation({
    operationId: 'auth.totpSetup',
    summary: 'Start TOTP enrollment (new secret, replaces a pending one)',
  })
  @ApiOkEnvelope(ref(TotpSetupDto))
  @ApiFailureResponse(HttpStatus.CONFLICT, 'TOTP_ALREADY_ENABLED')
  setupTotp(@CurrentUser() user: AuthUser): Promise<TotpSetupDto> {
    return this.auth.setupTotp(user.id);
  }

  @Post('totp/enable')
  @Throttle({ [IP_THROTTLER]: RATE_LIMITS.totp })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage(
    'TOTP enabled; log in again with a code to use privileged roles',
  )
  @ApiOperation({
    operationId: 'auth.totpEnable',
    summary: 'Confirm TOTP enrollment with a first code',
  })
  @ApiOkEnvelope(ref(TotpEnabledDto))
  @ApiFailureResponse(
    HttpStatus.CONFLICT,
    'TOTP_NOT_SET_UP or TOTP_ALREADY_ENABLED',
  )
  @ApiFailureResponse(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_TOTP')
  async enableTotp(
    @CurrentUser() user: AuthUser,
    @Body() dto: TotpCodeDto,
  ): Promise<TotpEnabledDto> {
    await this.totp.enable(user.id, dto.code);
    return { totpEnabled: true };
  }
}
