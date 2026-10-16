import type { z } from 'zod';

/**
 * A versioned event contract (A-B14.4): the name of an event, its schema revision and the zod
 * schema that validates its payload. Outbox payloads are audit events, so every contract wraps
 * the schema in `shared-kernel/audit/schemas` and exports the inferred type next to it.
 *
 * Rules: a published contract file never changes shape. A new field, a removed field or a
 * changed meaning is a new file (`<type>.v2.ts`) with `schemaVersion: 2`; consumers handle both
 * versions until v1 is retired. Handlers subscribe by type (`outbox.<type>`) and branch on
 * `payload.schemaVersion`.
 */
export interface EventContract<
  Type extends string = string,
  Version extends number = number,
  Schema extends z.ZodType = z.ZodType,
> {
  readonly type: Type;
  readonly schemaVersion: Version;
  readonly schema: Schema;
}

export function defineEventContract<
  const Type extends string,
  const Version extends number,
  Schema extends z.ZodType,
>(
  contract: EventContract<Type, Version, Schema>,
): EventContract<Type, Version, Schema> {
  return contract;
}
