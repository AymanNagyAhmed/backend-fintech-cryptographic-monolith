import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { RequestSigningModule } from '../../common/request-signing/request-signing.module.js';
import { UsersModule } from '../users/users.module.js';
import { ApiClientsService } from './api-clients/api-clients.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JWT_AUDIENCE, JWT_ISSUER } from './auth.types.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { SignedRequestGuard } from './guards/signed-request.guard.js';
import { TokenService } from './token.service.js';
import { TotpService } from './totp/totp.service.js';

@Module({
  imports: [
    UsersModule,
    RequestSigningModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
        // Pinned, so a token with alg "none" or another algorithm is rejected
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TotpService,
    ApiClientsService,
    // Order matters: authentication first, then roles; signed routes are @Public() for the JWT guard
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SignedRequestGuard },
  ],
  exports: [ApiClientsService, TotpService],
})
export class AuthModule {}
