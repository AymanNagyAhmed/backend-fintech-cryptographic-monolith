import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

async function errorsIn(code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: 'src/lint-fixture.ts' });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').length;
}

describe('lint rule: no float conversion of money (2.11)', () => {
  it.each([
    'parseFloat(amount);',
    'parseInt(dto.balance, 10);',
    'Number(req.body.price);',
    'Number.parseFloat(totalAmount);',
    'Number.parseInt(wallet?.balance);',
    'const x = +dto.amount;',
    'const y = +unitPrice;',
  ])('rejects %s', async (code) => {
    expect(await errorsIn(code)).toBe(1);
  });

  it.each([
    'Money.of(dto.amount, "USD");',
    'new Decimal(balance);',
    'Number(port);',
    'parseInt(page, 10);',
    'const n = +count;',
    'const total = a + amount;',
  ])('allows %s', async (code) => {
    expect(await errorsIn(code)).toBe(0);
  });
});
