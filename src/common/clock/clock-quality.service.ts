import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import {
  parseChronycTracking,
  qualityFromOffset,
  type ClockSample,
} from './clock-quality.js';

const execFileAsync = promisify(execFile);

/**
 * Reads chrony offset (or stub), caches briefly, and exposes quality for audit/STH
 * stamping and Prometheus (A-B16.5 / 2.9).
 */
@Injectable()
export class ClockQualityService {
  private readonly logger = new Logger(ClockQualityService.name);
  private readonly toleranceSeconds: number;
  private readonly source: 'chronyc' | 'stub';
  private readonly chronycBin: string;
  private readonly cacheMs: number;
  private cached: { at: number; sample: ClockSample } | null = null;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.toleranceSeconds = config.get('CLOCK_OFFSET_TOLERANCE_SEC', {
      infer: true,
    });
    this.source = config.get('CLOCK_QUALITY_SOURCE', { infer: true });
    this.chronycBin = config.get('CLOCK_CHRONYC_BIN', { infer: true });
    this.cacheMs = config.get('CLOCK_QUALITY_CACHE_MS', { infer: true });
  }

  /** Latest sample (cached). Safe to call on the audit write path. */
  async sample(): Promise<ClockSample> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < this.cacheMs) {
      return this.cached.sample;
    }
    const sample = await this.readFresh();
    this.cached = { at: now, sample };
    if (sample.outOfTolerance || sample.quality === 'unknown') {
      this.logger.warn(
        {
          offsetSeconds: sample.offsetSeconds,
          quality: sample.quality,
          toleranceSeconds: this.toleranceSeconds,
          source: sample.source,
        },
        'Clock out of tolerance or unreadable',
      );
    }
    return sample;
  }

  /** Force a fresh chronyc/stub read (metrics scrape). */
  async refresh(): Promise<ClockSample> {
    this.cached = null;
    return this.sample();
  }

  private async readFresh(): Promise<ClockSample> {
    if (this.source === 'stub') {
      return {
        offsetSeconds: 0,
        quality: 'ok',
        outOfTolerance: false,
        source: 'stub',
      };
    }
    try {
      const { stdout } = await execFileAsync(
        this.chronycBin,
        ['-n', 'tracking'],
        { timeout: 2_000, maxBuffer: 64_000 },
      );
      const { offsetSeconds } = parseChronycTracking(stdout);
      const { quality, outOfTolerance } = qualityFromOffset(
        offsetSeconds,
        this.toleranceSeconds,
      );
      return { offsetSeconds, quality, outOfTolerance, source: 'chronyc' };
    } catch (err) {
      this.logger.warn({ err }, 'chronyc tracking failed');
      return {
        offsetSeconds: Number.NaN,
        quality: 'unknown',
        // Treat unreadable clocks as out of tolerance so alerts fire.
        outOfTolerance: true,
        source: 'chronyc',
      };
    }
  }
}
