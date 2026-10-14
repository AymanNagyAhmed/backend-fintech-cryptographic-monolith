import type { EnvironmentVariables } from '../../config/env.validation.js';

/** Payment providers that may call POST /v1/webhooks/:provider, with the env key of their HMAC secret. */
export const WEBHOOK_PROVIDERS = {
  stripe: { secretEnv: 'WEBHOOK_SECRET_STRIPE' },
} as const satisfies Record<string, { secretEnv: keyof EnvironmentVariables }>;

export type WebhookProvider = keyof typeof WEBHOOK_PROVIDERS;

export const WEBHOOK_PROVIDER_NAMES = Object.keys(
  WEBHOOK_PROVIDERS,
) as WebhookProvider[];

export const isWebhookProvider = (name: unknown): name is WebhookProvider =>
  typeof name === 'string' && Object.hasOwn(WEBHOOK_PROVIDERS, name);
