import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import { WebhookEventDto } from './dto/webhook-event.dto.js';
import { WebhookReceiptDto } from './dto/webhook-receipt.dto.js';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard.js';
import { PaymentsService } from './payments.service.js';
import {
  WEBHOOK_PROVIDER_NAMES,
  type WebhookProvider,
} from './webhook-providers.js';
import { WEBHOOK_HEADERS } from './webhook-signature.js';

@ApiTags('Webhooks')
@ApiExtraModels(WebhookReceiptDto)
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':provider')
  @UseGuards(WebhookSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Webhook received')
  @ApiOperation({
    operationId: 'webhooks.receive',
    summary:
      'Receive a signed payment provider event (HMAC-SHA256 over timestamp.rawBody)',
  })
  @ApiParam({ name: 'provider', enum: WEBHOOK_PROVIDER_NAMES })
  @ApiHeader({
    name: WEBHOOK_HEADERS.timestamp,
    required: true,
    description:
      'Unix time in seconds; must be within 5 minutes of the server clock',
    schema: { type: 'string', example: '1760464800' },
  })
  @ApiHeader({
    name: WEBHOOK_HEADERS.signature,
    required: true,
    description:
      'hex(HMAC-SHA256(WEBHOOK_SECRET_<PROVIDER>, x-timestamp + "." + raw body))',
    schema: {
      type: 'string',
      example:
        '5f1d0c3a9b7e2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f1a3c5e7b9d0f',
    },
  })
  // The body is the provider's signed JSON: checked in the service, unknown fields allowed
  @ApiBody({ type: WebhookEventDto })
  @ApiOkEnvelope({ $ref: getSchemaPath(WebhookReceiptDto) })
  @ApiFailureResponse(
    HttpStatus.BAD_REQUEST,
    'WEBHOOK_SIGNATURE_HEADERS_INVALID, WEBHOOK_TIMESTAMP_EXPIRED, INVALID_WEBHOOK_SIGNATURE or INVALID_WEBHOOK_EVENT',
  )
  @ApiFailureResponse(HttpStatus.NOT_FOUND, 'WEBHOOK_PROVIDER_NOT_FOUND')
  receive(
    @Param('provider') provider: WebhookProvider,
    @Body() body: unknown,
  ): WebhookReceiptDto {
    return this.payments.receive(provider, body);
  }
}
