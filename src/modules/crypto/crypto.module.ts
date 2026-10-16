import { Module } from '@nestjs/common';
import { AuditKeysController } from './audit-keys.controller.js';
import {
  KeyRotationService,
  keyRotationProvider,
} from './key-rotation.service.js';
import { signerBackendProvider } from './signer-backend.provider.js';
import { SignerService } from './signer.service.js';
import { SigningKeysService } from './signing-keys.service.js';

/** Signing through KMS / OpenBao Transit (2.6, 2.7); owns the crypto schema. */
@Module({
  controllers: [AuditKeysController],
  providers: [
    signerBackendProvider,
    SignerService,
    SigningKeysService,
    keyRotationProvider,
  ],
  exports: [SignerService, SigningKeysService, KeyRotationService],
})
export class CryptoModule {}
