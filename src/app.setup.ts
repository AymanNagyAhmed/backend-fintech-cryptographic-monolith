import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';
import helmet from 'helmet';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import type { EnvironmentVariables } from './config/env.validation.js';

// Shared by main.ts and the e2e tests, so tests run the same HTTP pipeline as production
export function setupApp(app: INestApplication): INestApplication {
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy > 0) {
    const express: Express = app.getHttpAdapter().getInstance();
    express.set('trust proxy', trustProxy);
  }
  app.setGlobalPrefix('v1');
  // First middleware, so the id exists for every request (including 404s) and for the request logger
  app.use(new RequestIdMiddleware().use);
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }).split(','),
    credentials: true,
    exposedHeaders: [
      'x-request-id',
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
  });
  app.enableShutdownHooks();
  return app;
}
