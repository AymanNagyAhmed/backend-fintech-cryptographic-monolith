import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ENVELOPE_MODELS } from '../common/swagger/api-envelope.js';

export const SWAGGER_PATH = 'v1/docs';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Fintech Cryptographic Platform API')
    .setDescription(
      'Every response uses the envelope: success `{ success, statusCode, message, data, meta }`, ' +
        'failure `{ success, statusCode, error: { code, message, details? }, meta }`. Money amounts are decimal strings.',
    )
    .setVersion('v1')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, { extraModels: ENVELOPE_MODELS });
  // Serves the UI at /v1/docs and the spec at /v1/docs-json
  SwaggerModule.setup(SWAGGER_PATH, app, document, { jsonDocumentUrl: `${SWAGGER_PATH}-json` });
}
