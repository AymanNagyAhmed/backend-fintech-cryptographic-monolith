import { Decimal, parseDecimal } from '../../common/money/decimal.js';
import {
  invalidPosting,
  unbalancedPosting,
} from './exceptions/ledger.exceptions.js';

export interface PostingEntryInput {
  accountId: string;
  /** Signed decimal string: negative = debit, positive = credit */
  amount: string | Decimal;
}

export interface PostingInput {
  /** Business key of the posting, e.g. "transfer:<id>"; postable once (ledger.postings PK) */
  ref: string;
  entries: readonly PostingEntryInput[];
}

export interface ParsedPosting {
  ref: string;
  entries: { accountId: string; amount: Decimal }[];
  /** Distinct account ids, sorted: the lock order */
  accountIds: string[];
  /** Net amount per account */
  netByAccount: Map<string, Decimal>;
}

// Same rule as the ledger_entries_ref_chk / postings_ref_chk constraints
export const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** Checks shape and zero sum before any database access; currency and scale need the accounts. */
export function parsePosting(input: PostingInput): ParsedPosting {
  if (typeof input.ref !== 'string' || !REF_PATTERN.test(input.ref))
    throw invalidPosting('ref', 'must match ' + REF_PATTERN.source);
  if (input.entries.length < 2)
    throw invalidPosting('entries', 'a posting needs at least two entries');

  const entries = input.entries.map((e, i) => {
    const amount = parseDecimal(e.amount);
    if (amount.isZero())
      throw invalidPosting(`entries[${i}].amount`, 'must not be zero');
    return { accountId: e.accountId, amount };
  });

  const total = entries.reduce((s, e) => s.plus(e.amount), new Decimal(0));
  if (!total.isZero()) throw unbalancedPosting(total.toFixed());

  const netByAccount = new Map<string, Decimal>();
  for (const e of entries)
    netByAccount.set(
      e.accountId,
      (netByAccount.get(e.accountId) ?? new Decimal(0)).plus(e.amount),
    );

  return {
    ref: input.ref,
    entries,
    accountIds: [...netByAccount.keys()].sort(),
    netByAccount,
  };
}
