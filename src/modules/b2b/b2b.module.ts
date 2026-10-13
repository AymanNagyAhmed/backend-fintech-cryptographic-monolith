import { Module } from '@nestjs/common';
import { B2bController } from './b2b.controller.js';

/** Routes for B2B partners; every route is @SignedRequest() (checked by auth's SignedRequestGuard). */
@Module({
  controllers: [B2bController],
})
export class B2bModule {}
