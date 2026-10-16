import { Module } from '@nestjs/common';
import { SignerService } from './signer.service.js';

/**
 * Signing through KMS / OpenBao Transit (2.6, 2.7); owns the crypto schema. The SIGNER_BACKEND
 * adapter is provided with the adapters (A-B8.2); until then this module is not imported.
 */
@Module({
  providers: [SignerService],
  exports: [SignerService],
})
export class CryptoModule {}
