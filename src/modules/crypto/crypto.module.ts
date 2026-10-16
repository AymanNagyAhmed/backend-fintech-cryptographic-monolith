import { Module } from '@nestjs/common';
import { signerBackendProvider } from './signer-backend.provider.js';
import { SignerService } from './signer.service.js';

/** Signing through KMS / OpenBao Transit (2.6, 2.7); owns the crypto schema. */
@Module({
  providers: [signerBackendProvider, SignerService],
  exports: [SignerService],
})
export class CryptoModule {}
