import {
  WalletCreatedV1Schema,
  type WalletCreatedV1,
} from '../audit/schemas/wallet.v1.js';
import { defineEventContract } from './event-contract.js';

/** `wallet.created` v1: payload type and contract. Frozen; a change is `wallet.created.v2.ts`. */
export type { WalletCreatedV1 };

export const WALLET_CREATED_V1 = defineEventContract({
  type: 'wallet.created',
  schemaVersion: 1,
  schema: WalletCreatedV1Schema,
});
