import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import type { EnvironmentVariables } from './config/env.validation.js';
import { setupSwagger } from './config/swagger.config.js';

async function bootstrap() {
  // rawBody: webhook and signed-request verification need the exact bytes that were sent
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  setupApp(app);

  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  if (config.get('NODE_ENV', { infer: true }) !== 'production') setupSwagger(app);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
