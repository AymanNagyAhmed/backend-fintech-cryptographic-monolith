import {
  base32Encode,
  hotp,
  matchTotpStep,
  otpauthUri,
  totpStep,
} from './totp.js';

// RFC 6238 appendix B / RFC 4226 appendix D: SHA-1 key "12345678901234567890"
const RFC_KEY = Buffer.from('12345678901234567890');

describe('TOTP (RFC 4226 / 6238)', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [9, '520489'],
  ])('HOTP counter %i -> %s (RFC 4226)', (counter, code) => {
    expect(hotp(RFC_KEY, counter)).toBe(code);
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('TOTP at %i s -> %s (RFC 6238, 8 digits)', (seconds, code) => {
    expect(hotp(RFC_KEY, totpStep(seconds * 1000), 8)).toBe(code);
  });

  it('base32-encodes like RFC 4648 without padding', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(RFC_KEY)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  describe('matchTotpStep', () => {
    const now = 1_791_830_000_000;
    const step = totpStep(now);

    it('accepts the current step and one step of drift either way', () => {
      expect(matchTotpStep(RFC_KEY, hotp(RFC_KEY, step), now)).toBe(step);
      expect(matchTotpStep(RFC_KEY, hotp(RFC_KEY, step - 1), now)).toBe(
        step - 1,
      );
      expect(matchTotpStep(RFC_KEY, hotp(RFC_KEY, step + 1), now)).toBe(
        step + 1,
      );
    });

    it('rejects older or later codes, and malformed input', () => {
      expect(matchTotpStep(RFC_KEY, hotp(RFC_KEY, step - 2), now)).toBeNull();
      expect(matchTotpStep(RFC_KEY, hotp(RFC_KEY, step + 2), now)).toBeNull();
      expect(matchTotpStep(RFC_KEY, '12345', now)).toBeNull();
      expect(matchTotpStep(RFC_KEY, '12345a', now)).toBeNull();
    });
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const uri = new URL(otpauthUri(RFC_KEY, 'alice@example.com', 'Fintech'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe(
      '/Fintech:alice@example.com',
    );
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      issuer: 'Fintech',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});
