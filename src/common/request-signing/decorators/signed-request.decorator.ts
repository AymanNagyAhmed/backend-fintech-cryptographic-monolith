import { applyDecorators, HttpStatus, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator.js';
import { ApiFailureResponse } from '../../swagger/decorators/api-envelope.decorator.js';
import {
  SIGNATURE_HEADERS,
  SIGNATURE_WINDOW_SEC,
} from '../canonical-request.js';

export const SIGNED_REQUEST_KEY = 'signedRequest';

/**
 * B2B route: authenticated by a request signature (SignedRequestGuard) instead of a user's
 * Bearer token. The client signs `METHOD\npath\ntimestamp\nnonce\nhex(sha256(body))`.
 */
export const SignedRequest = () =>
  applyDecorators(
    SetMetadata(SIGNED_REQUEST_KEY, true),
    Public(),
    ApiHeader({
      name: SIGNATURE_HEADERS.clientId,
      required: true,
      description: 'API client id',
    }),
    ApiHeader({
      name: SIGNATURE_HEADERS.timestamp,
      required: true,
      description: `Unix seconds; within ${SIGNATURE_WINDOW_SEC} s of the server clock`,
    }),
    ApiHeader({
      name: SIGNATURE_HEADERS.nonce,
      required: true,
      description: '16-128 chars [A-Za-z0-9_-], new for every request',
    }),
    ApiHeader({
      name: SIGNATURE_HEADERS.signature,
      required: true,
      description:
        'base64 HMAC-SHA256 (client secret) or Ed25519 over the canonical string',
    }),
    ApiFailureResponse(
      HttpStatus.UNAUTHORIZED,
      'SIGNATURE_HEADERS_INVALID, INVALID_SIGNATURE, REQUEST_EXPIRED or NONCE_REUSED',
    ),
    ApiFailureResponse(
      HttpStatus.SERVICE_UNAVAILABLE,
      'REQUEST_SIGNING_UNAVAILABLE',
    ),
  );
