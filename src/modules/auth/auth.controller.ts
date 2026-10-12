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
import { Public } from '../../common/decorators/public.decorator.js';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto.js';
import {
  LogoutResultDto,
  TokenPairDto,
  UserProfileDto,
} from './dto/auth-response.dto.js';

const ref = (model: new () => object) => ({ $ref: getSchemaPath(model) });

@ApiTags('Auth')
@ApiExtraModels(TokenPairDto, UserProfileDto, LogoutResultDto)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
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
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged in')
  @ApiOperation({
    operationId: 'auth.login',
    summary: 'Exchange email and password for tokens',
  })
  @ApiOkEnvelope(ref(TokenPairDto))
  @ApiFailureResponse(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS')
  @ApiFailureResponse(HttpStatus.FORBIDDEN, 'ACCOUNT_INACTIVE')
  login(@Body() dto: LoginDto): Promise<TokenPairDto> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
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
}
