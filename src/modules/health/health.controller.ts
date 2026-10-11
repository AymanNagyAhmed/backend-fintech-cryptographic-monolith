import { Controller, Get, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  type HealthCheckResult,
  type HealthIndicatorFunction,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../../common/decorators/response-message.decorator.js';
import { DomainException } from '../../common/exceptions/domain.exception.js';
import { ApiFailureResponse, ApiOkEnvelope } from '../../common/swagger/api-envelope.js';
import { HEAP_LIMIT_BYTES } from './health.constants.js';
import { OpenBaoHealthIndicator } from './indicators/openbao.health.js';
import { PostgresHealthIndicator } from './indicators/postgres.health.js';
import { RedisHealthIndicator } from './indicators/redis.health.js';

const HEALTH_RESULT = {
  type: 'object',
  example: { status: 'ok', info: { database: { status: 'up', responseTime: 3 } }, error: {}, details: {} },
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly postgres: PostgresHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly openbao: OpenBaoHealthIndicator,
  ) {}

  /** Liveness: the process responds. Never checks dependencies, so an outage does not trigger restarts. */
  @Get('live')
  @HealthCheck({ swaggerDocumentation: false })
  @ResponseMessage('Service is live')
  @ApiOperation({ summary: 'Liveness probe (process only, no dependencies)' })
  @ApiOkEnvelope(HEALTH_RESULT)
  @ApiFailureResponse(503, 'Heap above the limit')
  live(): Promise<HealthCheckResult> {
    return this.run([() => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES)]);
  }

  /** Readiness: every dependency needed to serve traffic answers in time. */
  @Get('ready')
  @HealthCheck({ swaggerDocumentation: false })
  @ResponseMessage('Service is ready')
  @ApiOperation({ summary: 'Readiness probe (PostgreSQL, Redis, OpenBao)' })
  @ApiOkEnvelope(HEALTH_RESULT)
  @ApiFailureResponse(503, 'A dependency is down; error.details names it')
  ready(): Promise<HealthCheckResult> {
    return this.run([() => this.postgres.check(), () => this.redis.check(), () => this.openbao.check()]);
  }

  private async run(checks: HealthIndicatorFunction[]): Promise<HealthCheckResult> {
    try {
      return await this.health.check(checks);
    } catch (e) {
      if (!(e instanceof ServiceUnavailableException)) throw e;
      const result = e.getResponse() as HealthCheckResult;
      // Only names and status reach the client; Terminus already logged the underlying errors
      const details = Object.entries(result.error ?? {}).map(([field, value]) => ({
        field,
        issue: value?.status ?? 'down',
      }));
      throw new DomainException(
        'SERVICE_UNAVAILABLE',
        'One or more dependencies are unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
        details,
        true,
      );
    }
  }
}
