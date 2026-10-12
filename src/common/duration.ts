const UNIT_SECONDS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const;

/** `15m`, `7d`, `3600s` -> seconds; the same format env.validation.ts accepts for *_TTL. */
export function durationToSeconds(value: string): number {
  const m = /^(\d+)([smhd])$/.exec(value);
  if (!m) throw new Error(`Invalid duration "${value}", expected e.g. 15m, 7d`);
  const seconds =
    Number(m[1]) * UNIT_SECONDS[m[2] as keyof typeof UNIT_SECONDS];
  if (seconds <= 0) throw new Error(`Duration "${value}" must be positive`);
  return seconds;
}
