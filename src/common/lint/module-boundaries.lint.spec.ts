import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

// Imports must resolve to real files, so the targets below exist on disk.
async function boundaryErrors(filePath: string, code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'boundaries/dependencies')
    .length;
}

describe('lint rule: module boundaries without barrels (A-B14.1)', () => {
  it.each([
    // deep import of another module's internals
    [
      'src/modules/payments/lint-fixture.ts',
      "import { x } from '../ledger/posting.js';",
    ],
    [
      'src/modules/payments/lint-fixture.ts',
      "import { x } from '../ledger/jobs/reconciliation.constants.js';",
    ],
    // value import from a *.types.ts (only `import type` is free)
    [
      'src/modules/b2b/lint-fixture.ts',
      "import { x } from '../auth/auth.types.js';",
    ],
    // platform layers must not depend on feature modules
    [
      'src/common/lint-fixture.ts',
      "import { x } from '../modules/ledger/ledger.service.js';",
    ],
    [
      'src/shared-kernel/lint-fixture.ts',
      "import { x } from '../modules/ledger/ledger.service.js';",
    ],
  ])('rejects %s: %s', async (file, code) => {
    expect(await boundaryErrors(file, code)).toBe(1);
  });

  it.each([
    // public surface: service, module, dto, exceptions
    [
      'src/modules/payments/lint-fixture.ts',
      "import { x } from '../ledger/ledger.service.js';",
    ],
    [
      'src/modules/payments/lint-fixture.ts',
      "import { x } from '../ledger/ledger.module.js';",
    ],
    [
      'src/modules/payments/lint-fixture.ts',
      "import { x } from '../ledger/exceptions/ledger.exceptions.js';",
    ],
    [
      'src/modules/b2b/lint-fixture.ts',
      "import { x } from '../auth/dto/login.dto.js';",
    ],
    [
      'src/modules/b2b/lint-fixture.ts',
      "import type { x } from '../auth/auth.types.js';",
    ],
    // inside the same module anything goes
    ['src/modules/ledger/lint-fixture.ts', "import { x } from './posting.js';"],
    // platform layers
    [
      'src/modules/payments/lint-fixture.ts',
      "import { x } from '../../common/money/money.js';",
    ],
    ['src/common/lint-fixture.ts', "import { x } from '../money/money.js';"],
    // composition root
    [
      'src/lint-fixture.ts',
      "import { x } from './modules/ledger/ledger.module.js';",
    ],
  ])('allows %s: %s', async (file, code) => {
    expect(await boundaryErrors(file, code)).toBe(0);
  });
});
