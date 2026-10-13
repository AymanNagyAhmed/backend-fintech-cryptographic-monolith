import { Decimal } from '../../common/money/decimal.js';
import { parsePosting } from './posting.js';

const A = '0199c1a0-0000-7000-8000-00000000000a';
const B = '0199c1a0-0000-7000-8000-00000000000b';
const C = '0199c1a0-0000-7000-8000-00000000000c';

describe('parsePosting', () => {
  it('nets amounts per account and sorts the lock order', () => {
    const parsed = parsePosting({
      ref: 'transfer:1',
      entries: [
        { accountId: C, amount: '-10.00' },
        { accountId: A, amount: '7.50' },
        { accountId: B, amount: '2.50' },
        { accountId: A, amount: '-1' },
        { accountId: B, amount: new Decimal('1') },
      ],
    });
    expect(parsed.accountIds).toEqual([A, B, C]);
    expect(parsed.netByAccount.get(A)!.toFixed()).toBe('6.5');
    expect(parsed.netByAccount.get(B)!.toFixed()).toBe('3.5');
    expect(parsed.netByAccount.get(C)!.toFixed()).toBe('-10');
    expect(parsed.entries).toHaveLength(5);
  });

  it('is exact: 0.1 ten thousand times balances 1000', () => {
    const entries = Array.from({ length: 10_000 }, () => ({
      accountId: A,
      amount: '0.1',
    }));
    const parsed = parsePosting({
      ref: 'r',
      entries: [...entries, { accountId: B, amount: '-1000.0' }],
    });
    expect(parsed.netByAccount.get(A)!.toFixed(1)).toBe('1000.0');
  });

  it.each([
    ['', 'ref'],
    ['has space', 'ref'],
    ['-leading-dash', 'ref'],
    ['x'.repeat(129), 'ref'],
  ])('rejects ref %j with INVALID_POSTING', (ref, field) => {
    expect(() =>
      parsePosting({
        ref,
        entries: [
          { accountId: A, amount: '1' },
          { accountId: B, amount: '-1' },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_POSTING',
        details: [expect.objectContaining({ field })],
      }),
    );
  });

  it('needs at least two entries', () => {
    expect(() =>
      parsePosting({ ref: 'r', entries: [{ accountId: A, amount: '1' }] }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_POSTING' }));
  });

  it('rejects a zero amount', () => {
    expect(() =>
      parsePosting({
        ref: 'r',
        entries: [
          { accountId: A, amount: '0.00' },
          { accountId: B, amount: '0' },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_POSTING',
        details: [{ field: 'entries[0].amount', issue: 'must not be zero' }],
      }),
    );
  });

  it('rejects entries that do not sum to zero', () => {
    expect(() =>
      parsePosting({
        ref: 'r',
        entries: [
          { accountId: A, amount: '10' },
          { accountId: B, amount: '-9.99' },
        ],
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'UNBALANCED_POSTING',
        details: [{ field: 'entries', issue: 'amounts sum to 0.01' }],
      }),
    );
  });

  it.each([['1e3'], ['1.5.0'], [' 1']])(
    'rejects the non-decimal amount %j',
    (amount) => {
      expect(() =>
        parsePosting({
          ref: 'r',
          entries: [
            { accountId: A, amount },
            { accountId: B, amount: '-1' },
          ],
        }),
      ).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    },
  );
});
