import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import { ClockQualityService } from '../clock/clock-quality.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OutboxLagService } from '../../modules/outbox/outbox-lag.service.js';
import type { ChainerRunResult } from '../../modules/audit/chainer.service.js';

/**
 * Prometheus registry (A-B16.5 clock; A-B16.7 outbox/chainer/checkpoint/TSA/witness).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly register = new Registry();
  private readonly offsetSeconds: Gauge;
  private readonly outOfTolerance: Gauge;
  private readonly outboxLag: Gauge;
  private readonly checkpointTreeSize: Gauge;
  private readonly checkpointAgeSeconds: Gauge;
  private readonly chainerChained: Counter;
  private readonly chainerSkippedLock: Counter;
  private readonly tsaFailures: Counter;
  private readonly witnessAlerts: Counter;
  private readonly signatureVerifyFailures: Counter;
  private readonly withdrawalLimitBreaches: Counter;
  private readonly refreshReuse: Counter;

  constructor(
    private readonly clock: ClockQualityService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly outboxLagService?: OutboxLagService,
  ) {
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
    this.outboxLag = new Gauge({
      name: 'fintech_outbox_lag',
      help: 'Unprocessed outbox rows across contexts',
      registers: [this.register],
    });
    this.checkpointTreeSize = new Gauge({
      name: 'fintech_checkpoint_tree_size',
      help: 'Latest signed tree head treeSize (0 if none)',
      registers: [this.register],
    });
    this.checkpointAgeSeconds = new Gauge({
      name: 'fintech_checkpoint_age_seconds',
      help: 'Seconds since the latest STH timestamp',
      registers: [this.register],
    });
    this.chainerChained = new Counter({
      name: 'fintech_chainer_chained_total',
      help: 'Audit leaves chained from the outbox',
      registers: [this.register],
    });
    this.chainerSkippedLock = new Counter({
      name: 'fintech_chainer_skipped_lock_total',
      help: 'Outbox rows skipped because the partition lock was held',
      registers: [this.register],
    });
    this.tsaFailures = new Counter({
      name: 'fintech_tsa_failures_total',
      help: 'RFC 3161 TSA stamp failures after an STH was stored',
      registers: [this.register],
    });
    this.witnessAlerts = new Counter({
      name: 'fintech_witness_alerts_total',
      help: 'Witness job detections (fork, truncation, or rollback)',
      registers: [this.register],
    });
    this.signatureVerifyFailures = new Counter({
      name: 'fintech_signature_verify_failures_total',
      help: 'SignerService.verify results that returned false',
      registers: [this.register],
    });
    this.withdrawalLimitBreaches = new Counter({
      name: 'fintech_withdrawal_limit_breaches_total',
      help: 'Transfer or withdrawal rejections for a daily limit',
      registers: [this.register],
    });
    this.refreshReuse = new Counter({
      name: 'fintech_refresh_reuse_total',
      help: 'Refresh tokens presented again after they were used',
      registers: [this.register],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.register, prefix: 'fintech_' });
  }

  get contentType(): string {
    return this.register.contentType;
  }

  recordChainer(result: ChainerRunResult): void {
    if (result.chained > 0) this.chainerChained.inc(result.chained);
    if (result.skippedLock > 0) this.chainerSkippedLock.inc(result.skippedLock);
  }

  recordTsaFailure(): void {
    this.tsaFailures.inc();
  }

  recordWitnessAlert(): void {
    this.witnessAlerts.inc();
  }

  recordSignatureVerifyFailure(): void {
    this.signatureVerifyFailures.inc();
  }

  recordWithdrawalLimitBreach(): void {
    this.withdrawalLimitBreaches.inc();
  }

  recordRefreshReuse(): void {
    this.refreshReuse.inc();
  }

  async scrape(): Promise<string> {
    const sample = await this.clock.refresh();
    if (Number.isFinite(sample.offsetSeconds)) {
      this.offsetSeconds.set(sample.offsetSeconds);
    } else {
      this.offsetSeconds.set(Number.NaN);
    }
    this.outOfTolerance.set(sample.outOfTolerance ? 1 : 0);

    if (this.outboxLagService) {
      this.outboxLag.set(await this.outboxLagService.lag());
    }
    if (this.prisma) {
      const latest = await this.prisma.treeHead.findFirst({
        orderBy: { treeSize: 'desc' },
        select: { treeSize: true, timestamp: true },
      });
      if (latest) {
        this.checkpointTreeSize.set(latest.treeSize);
        this.checkpointAgeSeconds.set(
          Math.max(0, (Date.now() - latest.timestamp.getTime()) / 1000),
        );
      } else {
        this.checkpointTreeSize.set(0);
        this.checkpointAgeSeconds.set(0);
      }
    }
    return this.register.metrics();
  }
}
