import { Module } from '@nestjs/common';
import { NonceStore } from './nonce.store.js';

@Module({
  providers: [NonceStore],
  exports: [NonceStore],
})
export class RequestSigningModule {}
