/**
 * OpenTelemetry Node SDK bootstrap (A-B16.7). Must load before Nest creates the
 * HTTP server so auto-instrumentation can patch modules.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://127.0.0.1:4318';
const serviceName = process.env.OTEL_SERVICE_NAME ?? 'fintech-backend';

let sdk: NodeSDK | undefined;

export function startTelemetry(): void {
  if (process.env.OTEL_SDK_DISABLED === 'true') return;
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
}
