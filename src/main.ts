import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import type { EnvironmentVariables } from './config/env.validation.js';

async function bootstrap() {
  // rawBody: webhook and signed-request verification need the exact bytes that were sent
  const app = await NestFactory.create(AppModule, { rawBody: true });
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

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
