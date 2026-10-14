// Result of one reconciliation run. Amounts are NUMERIC(20, 8) text, never JS numbers.

export interface BalanceMismatch {
  accountId: string;
  currency: string;
  /** ledger.accounts.balance */
  cached: string;
  /** SUM(ledger_entries.amount) of the account */
  computed: string;
  /** cached - computed */
  difference: string;
}

export interface UnbalancedPosting {
  ref: string;
  entries: number;
  currencies: number;
  sum: string;
}

export interface CurrencyTotal {
  currency: string;
  accounts: number;
  /** SUM of cached balances; 0 when every posting sums to 0 */
  balances: string;
  /** SUM of entry amounts; 0 when every posting sums to 0 */
  entries: string;
  balanced: boolean;
}

/** `total` counts every finding; `items` holds at most RECONCILIATION_MAX_ITEMS of them. */
export interface Findings<T> {
  total: number;
  items: T[];
}

export interface ReconciliationReport {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  checked: { accounts: number; postings: number; entries: number };
  balanceMismatches: Findings<BalanceMismatch>;
  unbalancedPostings: Findings<UnbalancedPosting>;
  currencyTotals: CurrencyTotal[];
}
