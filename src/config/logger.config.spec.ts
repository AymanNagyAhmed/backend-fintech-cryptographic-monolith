import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACT_PATHS } from './logger.config.js';

function capture(obj: Record<string, unknown>): string {
  let out = '';
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream).info(obj, 'test');
  return out;
}

describe('logger redaction (2.12)', () => {
  it('redacts the authorization header and cookies', () => {
    const line = capture({
      req: { headers: { authorization: 'Bearer eyJ.secret.jwt', cookie: 'sid=abc', host: 'x' } },
    });
    expect(line).not.toContain('eyJ.secret.jwt');
    expect(line).not.toContain('sid=abc');
    expect(line).toContain('"host":"x"');
  });

  it.each(['password', 'token', 'apiKey', 'secret', 'cardNumber'])(
    'redacts %s at the top level, one and two levels deep',
    (key) => {
      const line = capture({ [key]: 'v0-leak', body: { [key]: 'v1-leak' }, req: { body: { [key]: 'v2-leak' } } });
      expect(line).not.toMatch(/v[012]-leak/);
      expect(line.match(/\[REDACTED\]/g)).toHaveLength(3);
    },
  );
});
