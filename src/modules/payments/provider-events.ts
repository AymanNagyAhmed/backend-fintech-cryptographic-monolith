import { isCurrency } from '../../common/money/currency.js';
import { Money } from '../../common/money/money.js';
import type { WebhookProvider } from './webhook-providers.js';

/** Comparable fields of one provider event. Amount is a decimal string. */
export interface ProviderPayment {
  provider: WebhookProvider;
  eventId: string;
  amount: string;
  currency: string;
  /** Wallet the provider says the money is for. */
  destination: string;
}

/** Loads the provider's own copy of an event. A failure is `ProviderEventUnavailable`. */
export interface ProviderEvents {
  load(provider: WebhookProvider, eventId: string): Promise<ProviderPayment>;
}

export const PROVIDER_EVENTS = Symbol('PROVIDER_EVENTS');

/** The retrieve call failed or the body was not a usable event. Not a field mismatch. */
export class ProviderEventUnavailable extends Error {
  constructor() {
    super('The provider event could not be loaded.');
    this.name = 'ProviderEventUnavailable';
  }
}

/**
 * True when the retrieved record is the same payment as the signed callback.
 * Amounts compare as money, so "250" and "250.00" match and a different amount does not.
 */
export function providerPaymentMatches(
  expected: {
    provider: WebhookProvider;
    eventId: string;
    walletId: string;
    amount: Money;
  },
  record: ProviderPayment,
): boolean {
  if (record.provider !== expected.provider) return false;
  if (record.eventId !== expected.eventId) return false;
  if (record.destination !== expected.walletId) return false;
  if (!isCurrency(record.currency)) return false;
  try {
    return Money.of(record.amount, record.currency).equals(expected.amount);
  } catch {
    return false;
  }
}
