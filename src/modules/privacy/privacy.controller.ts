import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import {
  ApiFailureResponse,
  ApiOkEnvelope,
} from '../../common/swagger/decorators/api-envelope.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ErasureService } from './erasure.service.js';

@ApiTags('Privacy')
@ApiBearerAuth()
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly erasure: ErasureService) {}

  @Post('erasure/:userId')
  @Roles('compliance', 'admin')
  @ResponseMessage('Erasure requested')
  @ApiOperation({
    operationId: 'privacy.erasureRequest',
    summary: 'Request crypto-shredding erasure (needs a second approver)',
  })
  @ApiOkEnvelope({ type: 'object' })
  @ApiFailureResponse(401, 'Missing or invalid access token')
  @ApiFailureResponse(403, 'Requires compliance or admin with MFA')
  request(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.erasure.request(userId, user.id);
  }

  @Post('erasure/:requestId/approve')
  @Roles('compliance', 'admin')
  @ResponseMessage('Erasure completed')
  @ApiOperation({
    operationId: 'privacy.erasureApprove',
    summary: 'Second approver completes erasure (destroys subject key)',
  })
  @ApiOkEnvelope({ type: 'object' })
  @ApiFailureResponse(403, 'Four-eyes violation or role missing')
  @ApiFailureResponse(404, 'Request not found')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.erasure.approve(requestId, user.id);
  }
}
