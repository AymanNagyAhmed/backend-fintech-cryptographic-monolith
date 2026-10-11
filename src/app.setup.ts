import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import type { EnvironmentVariables } from './config/env.validation.js';

// Shared by main.ts and the e2e tests, so tests run the same HTTP pipeline as production
export function setupApp(app: INestApplication): INestApplication {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.setGlobalPrefix('v1');
  // First middleware, so the id exists for every request (including 404s) and for the request logger
  app.use(new RequestIdMiddleware().use);
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }).split(','),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.enableShutdownHooks();
  return app;
}
