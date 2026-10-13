import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import { SignedRequest } from '../../common/request-signing/decorators/signed-request.decorator.js';
import { ApiOkEnvelope } from '../../common/swagger/decorators/api-envelope.decorator.js';
import type { ApiClientRef } from '../auth/auth.types.js';
import { CurrentApiClient } from '../auth/decorators/current-api-client.decorator.js';
import { B2bPingDto } from './dto/b2b-ping.dto.js';
import { B2bPongDto } from './dto/b2b-pong.dto.js';

@ApiTags('B2B')
@ApiExtraModels(B2bPongDto)
@Controller('b2b')
export class B2bController {
  @Post('ping')
  @SignedRequest()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signature verified')
  @ApiOperation({
    operationId: 'b2b.ping',
    summary:
      'Check request signing: answers only a correctly signed, fresh request',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(B2bPongDto) })
  ping(
    @CurrentApiClient() client: ApiClientRef,
    @Body() dto: B2bPingDto,
  ): B2bPongDto {
    return {
      clientId: client.clientId,
      ...(dto.message !== undefined ? { message: dto.message } : {}),
      receivedAt: new Date().toISOString(),
    };
  }
}
