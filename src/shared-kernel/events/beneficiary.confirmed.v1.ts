import {
  BeneficiaryConfirmedV1Schema,
  type BeneficiaryConfirmedV1,
} from '../audit/schemas/beneficiary.v1.js';
import { defineEventContract } from './event-contract.js';

/** `beneficiary.confirmed` v1: payload type and contract. Frozen; a change is `beneficiary.confirmed.v2.ts`. */
export type { BeneficiaryConfirmedV1 };

export const BENEFICIARY_CONFIRMED_V1 = defineEventContract({
  type: 'beneficiary.confirmed',
  schemaVersion: 1,
  schema: BeneficiaryConfirmedV1Schema,
});
