import {
  AuditAccessV1Schema,
  type AuditAccessV1,
} from '../audit/schemas/audit.v1.js';
import { defineEventContract } from './event-contract.js';

/** `audit.access` v1: payload type and contract. Frozen; a change is `audit.access.v2.ts`. */
export type { AuditAccessV1 };

export const AUDIT_ACCESS_V1 = defineEventContract({
  type: 'audit.access',
  schemaVersion: 1,
  schema: AuditAccessV1Schema,
});
