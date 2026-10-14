import {
  isWithinWebhookWindow,
  signWebhookHeaders,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_PATTERN,
  WEBHOOK_WINDOW_SEC,
  webhookSignature,
} from './webhook-signature.js';

const SECRET = 'whsec_test_secret_0123456789abcdef';
const TS = '1760464800';
const BODY = '{"id":"evt_1"}';
// printf '%s.%s' 1760464800 '{"id":"evt_1"}' | openssl dgst -sha256 -hmac 'whsec_test_secret_0123456789abcdef'
const OPENSSL_SIG =
  '5e5a7573cd791c04946001728dbf11487eafa73f95129eb7f6a5d6575ffb9fac';

describe('webhook signature', () => {
  it('matches openssl over timestamp + "." + body', () => {
    expect(webhookSignature(SECRET, TS, BODY)).toBe(OPENSSL_SIG);
    expect(webhookSignature(SECRET, TS, Buffer.from(BODY))).toBe(OPENSSL_SIG);
  });

  it('verifies the right signature, also in uppercase hex', () => {
    expect(verifyWebhookSignature(SECRET, TS, BODY, OPENSSL_SIG)).toBe(true);
    expect(
      verifyWebhookSignature(SECRET, TS, BODY, OPENSSL_SIG.toUpperCase()),
    ).toBe(true);
  });

  it.each([
    ['another secret', `${SECRET}x`, TS, BODY],
    ['another timestamp', SECRET, '1760464801', BODY],
    ['a changed body', SECRET, TS, '{"id":"evt_2"}'],
    ['a body with a trailing space', SECRET, TS, `${BODY} `],
  ])('rejects %s', (_, secret, ts, body) => {
    expect(verifyWebhookSignature(secret, ts, body, OPENSSL_SIG)).toBe(false);
  });

  it('accepts only 64 hex characters', () => {
    expect(WEBHOOK_SIGNATURE_PATTERN.test(OPENSSL_SIG)).toBe(true);
    for (const bad of [
      OPENSSL_SIG.slice(1),
      `${OPENSSL_SIG}0`,
      `${OPENSSL_SIG.slice(1)}g`,
      `sha256=${OPENSSL_SIG}`,
    ])
      expect(WEBHOOK_SIGNATURE_PATTERN.test(bad)).toBe(false);
  });

  it('allows 5 minutes either way', () => {
    const now = Number(TS) * 1000;
    expect(isWithinWebhookWindow(TS, now + WEBHOOK_WINDOW_SEC * 1000)).toBe(
      true,
    );
    expect(isWithinWebhookWindow(TS, now - WEBHOOK_WINDOW_SEC * 1000)).toBe(
      true,
    );
    expect(
      isWithinWebhookWindow(TS, now + (WEBHOOK_WINDOW_SEC + 1) * 1000),
    ).toBe(false);
    expect(
      isWithinWebhookWindow(TS, now - (WEBHOOK_WINDOW_SEC + 1) * 1000),
    ).toBe(false);
  });

  it('signs the two headers for a provider', () => {
    expect(signWebhookHeaders(SECRET, BODY, TS)).toEqual({
      'x-timestamp': TS,
      'x-signature': OPENSSL_SIG,
    });
  });
});
