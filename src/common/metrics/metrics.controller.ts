import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../decorators/public.decorator.js';
import { MetricsService } from './metrics.service.js';

/** Prometheus scrape target (raw text; not the JSON API envelope). */
@ApiExcludeController()
@SkipThrottle()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<StreamableFile> {
    const body = await this.metrics.scrape();
    return new StreamableFile(Buffer.from(body, 'utf8'), {
      type: this.metrics.contentType,
      disposition: 'inline',
    });
  }
}
