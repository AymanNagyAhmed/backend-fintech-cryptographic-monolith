import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CURRENCY_SCALE, isCurrency } from '../../common/money/currency.js';
import { Decimal } from '../../common/money/decimal.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import {
  ProviderEventUnavailable,
  type ProviderEvents,
  type ProviderPayment,
} from './provider-events.js';
import type { WebhookProvider } from './webhook-providers.js';

const TIMEOUT_MS = 5_000;

/**
 * Stripe's event retrieve API: `GET /v1/events/:id`.
 * The webhook HMAC secret stays `WEBHOOK_SECRET_STRIPE`. This call uses `STRIPE_SECRET_KEY`.
 */
@Injectable()
export class StripeEventClient implements ProviderEvents {
  private readonly secret: string | undefined;
  private readonly baseUrl: string;
  /** Replaced in unit tests. Nest injects only the config. */
  fetchFn: typeof fetch = fetch;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.secret = config.get('STRIPE_SECRET_KEY', { infer: true });
    this.baseUrl = config
      .get('STRIPE_API_BASE', { infer: true })
      .replace(/\/+$/, '');
  }

  async load(
    provider: WebhookProvider,
    eventId: string,
  ): Promise<ProviderPayment> {
    if (provider !== 'stripe' || !this.secret)
      throw new ProviderEventUnavailable();
    const url = `${this.baseUrl}/v1/events/${encodeURIComponent(eventId)}`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.secret}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ProviderEventUnavailable();
    }
    if (!res?.ok) throw new ProviderEventUnavailable();
    const json: unknown = await res.json().catch(() => null);
    const record = providerPaymentFromStripeEvent(json);
    if (!record) throw new ProviderEventUnavailable();
    return record;
  }
}

/**
 * Reads the fields we compare. Accepts this platform's event (`data.walletId`,
 * decimal `data.amount`) and a Stripe event (`data.object.amount` in minor units,
 * `data.object.currency`, `data.object.metadata.walletId`).
 */
export function providerPaymentFromStripeEvent(
  body: unknown,
): ProviderPayment | null {
  if (typeof body !== 'object' || body === null) return null;
  const event = body as Record<string, unknown>;
  if (typeof event.id !== 'string' || event.id.length === 0) return null;
  const data = event.data;
  if (typeof data !== 'object' || data === null) return null;
  const fields = data as Record<string, unknown>;
  const direct = directPayment(event.id, fields);
  if (direct) return direct;
  return stripeObjectPayment(event.id, fields.object);
}

function directPayment(
  eventId: string,
  data: Record<string, unknown>,
): ProviderPayment | null {
  if (
    typeof data.walletId !== 'string' ||
    typeof data.amount !== 'string' ||
    typeof data.currency !== 'string'
  )
    return null;
  return {
    provider: 'stripe',
    eventId,
    destination: data.walletId,
    amount: data.amount,
    currency: data.currency,
  };
}

function stripeObjectPayment(
  eventId: string,
  object: unknown,
): ProviderPayment | null {
  if (typeof object !== 'object' || object === null) return null;
  const row = object as Record<string, unknown>;
  const currency =
    typeof row.currency === 'string' ? row.currency.toUpperCase() : '';
  if (!isCurrency(currency)) return null;
  const metadata = row.metadata;
  const destination =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as Record<string, unknown>).walletId
      : undefined;
  if (typeof destination !== 'string' || destination.length === 0) return null;
  if (!Number.isInteger(row.amount) || (row.amount as number) <= 0) return null;
  const scale = CURRENCY_SCALE[currency];
  const amount = new Decimal(String(row.amount))
    .div(new Decimal(10).pow(scale))
    .toFixed(scale);
  return {
    provider: 'stripe',
    eventId,
    destination,
    amount,
    currency,
  };
}
