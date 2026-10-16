import {
  CustodySignV1Schema,
  type CustodySignV1,
} from '../audit/schemas/custody.v1.js';
import { defineEventContract } from './event-contract.js';

/** `custody.sign` v1: payload type and contract. Frozen; a change is `custody.sign.v2.ts`. */
export type { CustodySignV1 };

export const CUSTODY_SIGN_V1 = defineEventContract({
  type: 'custody.sign',
  schemaVersion: 1,
  schema: CustodySignV1Schema,
});
