import {
  ErasureCompletedV1Schema,
  type ErasureCompletedV1,
} from '../audit/schemas/erasure.v1.js';
import { defineEventContract } from './event-contract.js';

/** `erasure.completed` v1: payload type and contract. Frozen; a change is `erasure.completed.v2.ts`. */
export type { ErasureCompletedV1 };

export const ERASURE_COMPLETED_V1 = defineEventContract({
  type: 'erasure.completed',
  schemaVersion: 1,
  schema: ErasureCompletedV1Schema,
});
