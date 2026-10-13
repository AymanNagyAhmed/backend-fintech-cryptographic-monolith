import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  canonicalRequest,
  CLIENT_ID_PATTERN,
  NONCE_PATTERN,
  NONCE_TTL_SEC,
  SIGNATURE_HEADERS,
  SIGNATURE_PATTERN,
  SIGNATURE_WINDOW_SEC,
  TIMESTAMP_PATTERN,
} from '../../../common/request-signing/canonical-request.js';
import { SIGNED_REQUEST_KEY } from '../../../common/request-signing/decorators/signed-request.decorator.js';
import {
  invalidSignature,
  nonceReused,
  requestExpired,
  signatureHeadersInvalid,
} from '../../../common/request-signing/exceptions/signed-request.exceptions.js';
import { NonceStore } from '../../../common/request-signing/nonce.store.js';
import { ApiClientsService } from '../api-clients/api-clients.service.js';
import type { AuthenticatedRequest } from '../auth.types.js';

const EMPTY_BODY = Buffer.alloc(0);

/**
 * Global guard for @SignedRequest() routes (2.13). Order: header format, time window,
 * signature, then the nonce, so only correctly signed requests can claim a nonce.
 */
@Injectable()
export class SignedRequestGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clients: ApiClientsService,
    private readonly nonces: NonceStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const signed = this.reflector.getAllAndOverride<boolean | undefined>(
      SIGNED_REQUEST_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!signed) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = (name: string, pattern: RegExp) => {
      const value = req.headers[name];
      if (typeof value !== 'string' || !pattern.test(value))
        throw signatureHeadersInvalid(name);
      return value;
    };
    const clientId = header(SIGNATURE_HEADERS.clientId, CLIENT_ID_PATTERN);
    const timestamp = header(SIGNATURE_HEADERS.timestamp, TIMESTAMP_PATTERN);
    const nonce = header(SIGNATURE_HEADERS.nonce, NONCE_PATTERN);
    const signature = header(SIGNATURE_HEADERS.signature, SIGNATURE_PATTERN);

    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - Number(timestamp)) > SIGNATURE_WINDOW_SEC)
      throw requestExpired();

    const client = await this.clients.findVerifier(clientId);
    const canonical = canonicalRequest({
      method: req.method,
      path: req.originalUrl,
      timestamp,
      nonce,
      // Without a parsed body (no or unknown content type) the hash is of empty bytes
      body: req.rawBody ?? EMPTY_BODY,
    });
    if (!client?.verify(canonical, Buffer.from(signature, 'base64')))
      throw invalidSignature();

    if (!(await this.nonces.claim(clientId, nonce, NONCE_TTL_SEC)))
      throw nonceReused();

    req.apiClient = { id: client.id, clientId: client.clientId };
    return true;
  }
}
