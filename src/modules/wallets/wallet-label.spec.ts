import { normalizeWalletLabel } from './wallet-label.js';

describe('normalizeWalletLabel', () => {
  it.each([
    ['Savings', 'Savings'],
    ['  Travel \u00A0', 'Travel'],
    ['Ferien 2027', 'Ferien 2027'],
    ['محفظة السفر', 'محفظة السفر'],
    ['Cafe\u0301', 'Caf\u00E9'],
    ['a'.repeat(50), 'a'.repeat(50)],
    ['💰'.repeat(50), '💰'.repeat(50)],
  ])('accepts %j as %j', (raw, expected) => {
    expect(normalizeWalletLabel(raw)).toBe(expected);
  });

  it.each([
    ['', 'must not be empty'],
    ['   ', 'must not be empty'],
    ['a'.repeat(51), 'must be at most 50 characters'],
    ['Sav\u0000ings', 'must not contain control characters'],
    ['Line\nbreak', 'must not contain control characters'],
    ['Tab\there', 'must not contain control characters'],
    ['Del\u007F', 'must not contain control characters'],
    ['C1\u0085x', 'must not contain control characters'],
  ])('rejects %j with INVALID_LABEL (422)', (raw, issue) => {
    expect(() => normalizeWalletLabel(raw)).toThrow(
      expect.objectContaining({
        code: 'INVALID_LABEL',
        statusCode: 422,
        details: [{ field: 'label', issue }],
      }),
    );
  });

  it('does not echo the label in the error', () => {
    try {
      normalizeWalletLabel('secret\u0001label');
      expect.unreachable();
    } catch (e) {
      expect(JSON.stringify(e) + String(e)).not.toContain('secret');
    }
  });
});
