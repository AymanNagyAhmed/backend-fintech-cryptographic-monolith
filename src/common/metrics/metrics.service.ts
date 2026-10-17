import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Gauge,
  Registry,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import { ClockQualityService } from '../clock/clock-quality.service.js';

/**
 * Prometheus registry (A-B16.5 clock gauges; A-B16.7 adds more series).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly register = new Registry();
  private readonly offsetSeconds: Gauge;
  private readonly outOfTolerance: Gauge;

  constructor(private readonly clock: ClockQualityService) {
    this.offsetSeconds = new Gauge({
      name: 'fintech_clock_offset_seconds',
      help: 'Host clock offset vs NTP from chronyc tracking (signed; NaN if unknown)',
      registers: [this.register],
    });
    this.outOfTolerance = new Gauge({
      name: 'fintech_clock_out_of_tolerance',
      help: '1 when |offset| exceeds CLOCK_OFFSET_TOLERANCE_SEC or chronyc is unreadable',
      registers: [this.register],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.register, prefix: 'fintech_' });
  }

  get contentType(): string {
    return this.register.contentType;
  }

  async scrape(): Promise<string> {
    const sample = await this.clock.refresh();
    if (Number.isFinite(sample.offsetSeconds)) {
      this.offsetSeconds.set(sample.offsetSeconds);
    } else {
      this.offsetSeconds.set(Number.NaN);
    }
    this.outOfTolerance.set(sample.outOfTolerance ? 1 : 0);
    return this.register.metrics();
  }
}
