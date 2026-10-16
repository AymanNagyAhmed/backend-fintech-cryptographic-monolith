import {
  TransferCompletedV1Schema,
  type TransferCompletedV1,
} from '../audit/schemas/transfer.v1.js';
import { defineEventContract } from './event-contract.js';

/** `transfer.completed` v1: payload type and contract. Frozen; a change is `transfer.completed.v2.ts`. */
export type { TransferCompletedV1 };

export const TRANSFER_COMPLETED_V1 = defineEventContract({
  type: 'transfer.completed',
  schemaVersion: 1,
  schema: TransferCompletedV1Schema,
});
