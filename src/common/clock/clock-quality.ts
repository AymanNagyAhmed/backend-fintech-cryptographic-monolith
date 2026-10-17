/** Observed clock quality stamped on audit leaves and STHs (2.9 / A-B16.5). */
export const CLOCK_QUALITIES = ['ok', 'degraded', 'unknown'] as const;
export type ClockQuality = (typeof CLOCK_QUALITIES)[number];

export interface ClockSample {
  /** Signed offset in seconds: positive = system clock fast of NTP. */
  offsetSeconds: number;
  quality: ClockQuality;
  /** True when |offset| exceeds the configured tolerance. */
  outOfTolerance: boolean;
  source: 'chronyc' | 'stub';
}

/**
 * Parse `chronyc tracking` (or `chronyc -n tracking`) stdout.
 * Uses the "System time" line (current estimated error vs NTP).
 */
export function parseChronycTracking(stdout: string): {
  offsetSeconds: number;
} {
  const match = stdout.match(
    /System time\s*:\s*([0-9]+(?:\.[0-9]+)?)\s+seconds\s+(fast|slow)\s+of NTP time/i,
  );
  if (!match) {
    throw new Error('chronyc tracking: missing System time line');
  }
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) {
    throw new Error('chronyc tracking: invalid System time offset');
  }
  const sign = match[2]!.toLowerCase() === 'fast' ? 1 : -1;
  return { offsetSeconds: sign * magnitude };
}

export function qualityFromOffset(
  offsetSeconds: number,
  toleranceSeconds: number,
): Pick<ClockSample, 'quality' | 'outOfTolerance'> {
  const outOfTolerance = Math.abs(offsetSeconds) > toleranceSeconds;
  return {
    outOfTolerance,
    quality: outOfTolerance ? 'degraded' : 'ok',
  };
}
