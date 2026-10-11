import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '../common/middleware/request-id.middleware.js';
import { getRequestId } from '../common/request-context.js';
import type { EnvironmentVariables } from './env.validation.js';

const SENSITIVE_KEYS = ['password', 'token', 'apiKey', 'secret', 'cardNumber'];

// pino wildcards match one level, so each key is listed at the top level, one level and two levels deep
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

export function loggerParams(nodeEnv: EnvironmentVariables['NODE_ENV']): Params {
  const isDev = nodeEnv === 'development';
  return {
    pinoHttp: {
      level: nodeEnv === 'test' ? 'silent' : isDev ? 'debug' : 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // RequestIdMiddleware runs before pino-http and has already set the header
      genReqId: (req: IncomingMessage) => String(req.headers[REQUEST_ID_HEADER] ?? ''),
      customAttributeKeys: { reqId: 'requestId' },
      // Adds the id to log lines written outside the request logger (e.g. background work started by a request)
      mixin: () => {
        const requestId = getRequestId();
        return requestId ? { requestId } : {};
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/v1/health') ?? false },
      transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
