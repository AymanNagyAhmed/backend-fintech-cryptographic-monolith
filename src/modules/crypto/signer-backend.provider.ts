import { KMSClient } from '@aws-sdk/client-kms';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { AwsKmsSigner } from './adapters/aws-kms.signer.js';
import { LocalTestSigner } from './adapters/local-test.signer.js';
import { OpenBaoTransitSigner } from './adapters/openbao-transit.signer.js';
import { SIGNER_BACKEND, type Signer } from './signer.js';

/** The Signer adapter named by SIGNER_BACKEND; none of them calls the key store at startup. */
export const signerBackendProvider: Provider<Signer> = {
  provide: SIGNER_BACKEND,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>): Signer => {
    const get = <K extends keyof EnvironmentVariables>(key: K) =>
      config.get(key, { infer: true });
    switch (get('SIGNER_BACKEND')) {
      case 'openbao':
        return new OpenBaoTransitSigner(get('BAO_ADDR'), get('BAO_TOKEN'));
      case 'aws-kms':
        return new AwsKmsSigner(new KMSClient({ region: get('AWS_REGION') }));
      case 'local':
        return new LocalTestSigner(get('SIGNING_ALG'), get('NODE_ENV'));
    }
  },
};
