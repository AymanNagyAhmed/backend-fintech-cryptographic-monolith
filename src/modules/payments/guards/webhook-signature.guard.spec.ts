import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DomainException } from '../../../common/exceptions/domain.exception.js';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { signWebhookHeaders } from '../webhook-signature.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';

const SECRET = 'whsec_test_secret_0123456789abcdef';
const BODY = '{"id":"evt_1","type":"payment.succeeded","data":{}}';

interface FakeRequest {
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  rawBody?: Buffer;
}

const context = (req: FakeRequest) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const config = {
  get: vi.fn((key: string) =>
    key === 'WEBHOOK_SECRET_STRIPE' ? SECRET : undefined,
  ),
} as unknown as ConfigService<EnvironmentVariables, true>;

const signed = (over: Partial<FakeRequest> = {}): FakeRequest => ({
  params: { provider: 'stripe' },
  headers: signWebhookHeaders(SECRET, BODY),
  rawBody: Buffer.from(BODY),
  ...over,
});

const codeOf = (req: FakeRequest) => {
  try {
    new WebhookSignatureGuard(config).canActivate(context(req));
    return 'passed';
  } catch (e) {
    const err = e as DomainException;
    return `${err.statusCode} ${err.code}`;
  }
};

describe('WebhookSignatureGuard', () => {
  it('passes a correctly signed, fresh webhook', () => {
    expect(codeOf(signed())).toBe('passed');
  });

  it.each(['paypal', 'constructor', '__proto__', 'Stripe'])(
    'answers 404 for the provider %j',
    (provider) => {
      expect(codeOf(signed({ params: { provider } }))).toBe(
        '404 WEBHOOK_PROVIDER_NOT_FOUND',
      );
    },
  );

  it.each([
    ['x-timestamp missing', { 'x-timestamp': undefined }],
    ['x-timestamp not a number', { 'x-timestamp': '17604648OO' }],
    ['x-signature missing', { 'x-signature': undefined }],
    ['x-signature base64', { 'x-signature': 'q83vEjRWeJA=' }],
  ])('answers 400 with %s', (_, headers) => {
    const req = signed();
    req.headers = { ...req.headers, ...headers };
    expect(codeOf(req)).toBe('400 WEBHOOK_SIGNATURE_HEADERS_INVALID');
  });

  it('answers 400 for a timestamp older than 5 minutes, even when signed', () => {
    const old = String(Math.floor(Date.now() / 1000) - 301);
    expect(
      codeOf(signed({ headers: signWebhookHeaders(SECRET, BODY, old) })),
    ).toBe('400 WEBHOOK_TIMESTAMP_EXPIRED');
  });

  it('answers 400 for a changed body, another secret or no body', () => {
    expect(codeOf(signed({ rawBody: Buffer.from(`${BODY} `) }))).toBe(
      '400 INVALID_WEBHOOK_SIGNATURE',
    );
    expect(
      codeOf(signed({ headers: signWebhookHeaders(`${SECRET}x`, BODY) })),
    ).toBe('400 INVALID_WEBHOOK_SIGNATURE');
    expect(codeOf(signed({ rawBody: undefined }))).toBe(
      '400 INVALID_WEBHOOK_SIGNATURE',
    );
  });

  it('accepts an empty body when that is what was signed', () => {
    expect(
      codeOf(
        signed({ headers: signWebhookHeaders(SECRET, ''), rawBody: undefined }),
      ),
    ).toBe('passed');
  });
});
