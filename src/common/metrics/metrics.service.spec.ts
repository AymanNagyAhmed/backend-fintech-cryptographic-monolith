import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClockQualityService } from '../clock/clock-quality.service.js';
import { MetricsService } from './metrics.service.js';

const prometheusDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docker/prometheus',
);

function service(): MetricsService {
  return new MetricsService({
    refresh: async () => ({
      offsetSeconds: 0,
      outOfTolerance: false,
      quality: 'ok',
      source: 'stub',
    }),
  } as unknown as ClockQualityService);
}

describe('MetricsService security counters', () => {
  it('moves verify, limit, and refresh counters independently', async () => {
    const metrics = service();
    metrics.recordSignatureVerifyFailure();
    metrics.recordWithdrawalLimitBreach();
    metrics.recordWithdrawalLimitBreach();
    metrics.recordRefreshReuse();
    const text = await metrics.register.metrics();
    expect(text).toContain('fintech_signature_verify_failures_total 1');
    expect(text).toContain('fintech_withdrawal_limit_breaches_total 2');
    expect(text).toContain('fintech_refresh_reuse_total 1');
  });
});

const alertsPresent = existsSync(
  resolve(prometheusDir, 'alerts', 'security.yml'),
);

describe.skipIf(!alertsPresent)('Prometheus security alerts', () => {
  const alertsDir = resolve(prometheusDir, 'alerts');

  it('loads the three new rules beside the audit and clock rules', () => {
    const loaded = readdirSync(alertsDir)
      .filter((name) => name.endsWith('.yml'))
      .map((name) => readFileSync(resolve(alertsDir, name), 'utf8'))
      .join('\n');
    const prometheus = readFileSync(
      resolve(prometheusDir, 'prometheus.yml'),
      'utf8',
    );
    expect(prometheus).toContain('/etc/prometheus/alerts/*.yml');
    expect(loaded).toContain(
      'increase(fintech_signature_verify_failures_total[15m]) > 0',
    );
    expect(loaded).toContain(
      'increase(fintech_withdrawal_limit_breaches_total[15m]) > 0',
    );
    expect(loaded).toContain('increase(fintech_refresh_reuse_total[15m]) > 0');
    expect(loaded).toContain('alert: OutboxLagHigh');
    expect(loaded).toContain('alert: CheckpointStale');
    expect(loaded).toContain('alert: TsaFailures');
    expect(loaded).toContain('alert: WitnessAlert');
    expect(loaded).toContain('alert: ClockOffsetOutOfTolerance');
    expect(loaded).toContain('alert: ClockOffsetHigh');
  });

  it('pages verify failures and limit breaches as warning and refresh reuse as critical', () => {
    const security = readFileSync(resolve(alertsDir, 'security.yml'), 'utf8');
    const rules = security.split(/\n\s*- alert: /).slice(1);
    const severity = (name: string) => {
      const rule = rules.find((body) => body.startsWith(name));
      const match = rule?.match(/severity:\s*(\w+)/);
      return match?.[1];
    };
    expect(severity('SignatureVerifyFailures')).toBe('warning');
    expect(severity('WithdrawalLimitBreaches')).toBe('warning');
    expect(severity('RefreshTokenReuse')).toBe('critical');
  });
});
