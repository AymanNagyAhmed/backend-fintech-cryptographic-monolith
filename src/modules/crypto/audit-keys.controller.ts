import { Controller, Get } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import { ApiOkEnvelope } from '../../common/swagger/decorators/api-envelope.decorator.js';
import { SigningKeyDto, SigningKeyPageDto } from './dto/signing-key.dto.js';
import { SigningKeysService } from './signing-keys.service.js';

/**
 * Public catalog of signing public keys (2.6, 2.7). Path is under /audit so offline
 * verifiers and auditors share one place with later audit endpoints; the table lives in
 * crypto (CryptoModule owns it).
 */
@ApiTags('Audit')
@ApiExtraModels(SigningKeyDto, SigningKeyPageDto)
@Public()
@SkipThrottle()
@Controller('audit')
export class AuditKeysController {
  constructor(private readonly keys: SigningKeysService) {}

  @Get('keys')
  @ResponseMessage('Signing keys')
  @ApiOperation({
    operationId: 'audit.listKeys',
    summary: 'List published signing public keys (including revoked ones)',
  })
  @ApiOkEnvelope({ $ref: getSchemaPath(SigningKeyPageDto) })
  async list(): Promise<SigningKeyPageDto> {
    return { items: await this.keys.list() };
  }
}
