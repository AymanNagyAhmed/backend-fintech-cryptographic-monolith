import type { NextFunction, Request, Response } from 'express';
import { getRequestId } from '../request-context.js';
import { RequestIdMiddleware } from './request-id.middleware.js';

function run(incoming?: string) {
  const headers: Record<string, string> = {};
  const req = {
    headers: incoming ? { 'x-request-id': incoming } : {},
    header: (name: string) => (name === 'x-request-id' ? incoming : undefined),
  } as unknown as Request;
  const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as Response;
  let seenInContext: string | undefined;
  const next: NextFunction = () => {
    seenInContext = getRequestId();
  };
  new RequestIdMiddleware().use(req, res, next);
  return { echoed: headers['x-request-id'], seenInContext, forwarded: req.headers['x-request-id'] };
}

describe('RequestIdMiddleware', () => {
  it('generates req_<hex> when the header is missing and exposes it in the context', () => {
    const { echoed, seenInContext, forwarded } = run();
    expect(echoed).toMatch(/^req_[0-9a-f]{24}$/);
    expect(seenInContext).toBe(echoed);
    expect(forwarded).toBe(echoed);
  });

  it('keeps a safe client id', () => {
    expect(run('client-abc_123.4').echoed).toBe('client-abc_123.4');
  });

  it.each(['short', 'has space inside', 'line\nbreak-injection', 'x'.repeat(129)])(
    'replaces an unsafe client id %j',
    (bad) => {
      expect(run(bad).echoed).toMatch(/^req_[0-9a-f]{24}$/);
    },
  );
});
