import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  SIGNATURE_WINDOW_SEC,
  signRequestHeaders,
} from '../../../common/request-signing/canonical-request.js';
import { SIGNED_REQUEST_KEY } from '../../../common/request-signing/decorators/signed-request.decorator.js';
import type { NonceStore } from '../../../common/request-signing/nonce.store.js';
import type {
  ApiClientsService,
  ApiClientVerifier,
} from '../api-clients/api-clients.service.js';
import type { AuthenticatedRequest } from '../auth.types.js';
import { SignedRequestGuard } from './signed-request.guard.js';

const SECRET = 'b2b_unit-test-secret';
const hmacVerifier: ApiClientVerifier = {
  id: '0199e0e0-0000-7000-8000-000000000001',
  clientId: 'dev-client',
  verify: (canonical, signature) => {
    const expected = createHmac('sha256', SECRET).update(canonical).digest();
    return (
      signature.length === expected.length &&
      timingSafeEqual(signature, expected)
    );
  },
};

describe('SignedRequestGuard', () => {
  const body = '{"message":"hi"}';
  let claimed: Set<string>;
  let claim: ReturnType<typeof vi.fn>;
  let findVerifier: ReturnType<typeof vi.fn>;
  let guard: SignedRequestGuard;

  beforeEach(() => {
    claimed = new Set();
    claim = vi.fn(async (clientId: string, nonce: string) => {
      const key = `${clientId}:${nonce}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    });
    findVerifier = vi.fn(async (id: string) =>
      id === 'dev-client' ? hmacVerifier : null,
    );
    guard = new SignedRequestGuard(
      new Reflector(),
      { findVerifier } as unknown as ApiClientsService,
      { claim } as unknown as NonceStore,
    );
  });

  const request = (
    headers: Record<string, string>,
    over: Partial<AuthenticatedRequest> = {},
  ) =>
    ({
      method: 'POST',
      originalUrl: '/v1/b2b/ping',
      headers,
      rawBody: Buffer.from(body),
      ...over,
    }) as AuthenticatedRequest;

  const contextFor = (req: AuthenticatedRequest, signed = true) => {
    const handler = () => undefined;
    if (signed) Reflect.defineMetadata(SIGNED_REQUEST_KEY, true, handler);
    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  };

  const signed = (
    over: { timestamp?: string; nonce?: string; key?: string } = {},
  ) =>
    signRequestHeaders({
      clientId: 'dev-client',
      key: SECRET,
      method: 'POST',
      path: '/v1/b2b/ping',
      body,
      ...over,
    });

  const codeOf = async (req: AuthenticatedRequest) =>
    guard.canActivate(contextFor(req)).then(
      () => 'OK',
      (e: { code?: string }) => e.code,
    );

  it('ignores routes without @SignedRequest()', async () => {
    await expect(
      guard.canActivate(contextFor(request({}), false)),
    ).resolves.toBe(true);
    expect(findVerifier).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed request and sets the api client', async () => {
    const req = request(signed());
    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.apiClient).toEqual({
      id: hmacVerifier.id,
      clientId: 'dev-client',
    });
  });

  it('rejects a replay (same nonce)', async () => {
    const headers = signed();
    expect(await codeOf(request(headers))).toBe('OK');
    expect(await codeOf(request(headers))).toBe('NONCE_REUSED');
  });

  it('rejects a timestamp outside the window, either way', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const ts of [
      now - SIGNATURE_WINDOW_SEC - 60,
      now + SIGNATURE_WINDOW_SEC + 60,
    ])
      expect(await codeOf(request(signed({ timestamp: String(ts) })))).toBe(
        'REQUEST_EXPIRED',
      );
    expect(claim).not.toHaveBeenCalled();
  });

  it('rejects a changed body, path or method, without claiming the nonce', async () => {
    const headers = signed();
    expect(
      await codeOf(
        request(headers, { rawBody: Buffer.from('{"message":"hj"}') }),
      ),
    ).toBe('INVALID_SIGNATURE');
    expect(
      await codeOf(request(headers, { originalUrl: '/v1/b2b/ping?x=1' })),
    ).toBe('INVALID_SIGNATURE');
    expect(await codeOf(request(headers, { method: 'PUT' }))).toBe(
      'INVALID_SIGNATURE',
    );
    expect(claim).not.toHaveBeenCalled();
    // The genuine request still goes through afterwards
    expect(await codeOf(request(headers))).toBe('OK');
  });

  it('rejects a wrong key and an unknown client with the same code', async () => {
    expect(await codeOf(request(signed({ key: 'b2b_other' })))).toBe(
      'INVALID_SIGNATURE',
    );
    const unknown = { ...signed(), 'x-client-id': 'nobody-here' };
    expect(await codeOf(request(unknown))).toBe('INVALID_SIGNATURE');
  });

  it.each([
    ['x-client-id', 'Bad Client'],
    ['x-timestamp', '17e9'],
    ['x-nonce', 'short'],
    ['x-signature', 'not base64!'],
  ])('rejects a malformed %s', async (name, value) => {
    const err = await guard
      .canActivate(contextFor(request({ ...signed(), [name]: value })))
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: 'SIGNATURE_HEADERS_INVALID',
      details: [{ field: name, issue: 'missing or malformed' }],
    });
  });

  it('rejects missing headers', async () => {
    expect(await codeOf(request({}))).toBe('SIGNATURE_HEADERS_INVALID');
  });

  it('hashes empty bytes when there is no raw body', async () => {
    const headers = signRequestHeaders({
      clientId: 'dev-client',
      key: SECRET,
      method: 'GET',
      path: '/v1/b2b/ping',
      body: '',
    });
    expect(
      await codeOf(request(headers, { method: 'GET', rawBody: undefined })),
    ).toBe('OK');
  });
});
