import { Global, Module } from '@nestjs/common';
import { ClockQualityService } from './clock-quality.service.js';

@Global()
@Module({
  providers: [ClockQualityService],
  exports: [ClockQualityService],
})
export class ClockQualityModule {}
