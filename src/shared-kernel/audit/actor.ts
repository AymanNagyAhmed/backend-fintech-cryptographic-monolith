import { z } from 'zod';

/**
 * Who caused the event, without PII (2.8, 2.12). Use an opaque subject reference
 * (e.g. user id), never email, name or document numbers in the chained payload.
 */
export const ActorSchema = z
  .object({
    subjectRef: z.string().min(1).max(128),
    /** Machine client id when the actor is a B2B api_client, not a user. */
    clientId: z.string().min(1).max(64).optional(),
  })
  .strict();

export type Actor = z.infer<typeof ActorSchema>;
