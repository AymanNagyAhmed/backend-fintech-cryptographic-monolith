import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { HotColdService } from './hot-cold.service.js';

describe('HotColdService', () => {
  const service = new HotColdService({
    get: vi.fn().mockReturnValue(5),
  } as unknown as ConfigService<EnvironmentVariables, true>);

  it('alerts when hot share exceeds max', () => {
    const snap = service.evaluate('AED', '600.00', '400.00');
    expect(snap.hotShare).toBe('60.00');
    expect(snap.alert).toBe(true);
  });

  it('is quiet at or below max', () => {
    const snap = service.evaluate('AED', '50.00', '950.00');
    expect(snap.hotShare).toBe('5.00');
    expect(snap.alert).toBe(false);
  });

  it('handles zero total', () => {
    const snap = service.evaluate('BTC', '0.00000000', '0.00000000');
    expect(snap.alert).toBe(false);
    expect(snap.hotShare).toBe('0.00');
  });
});
