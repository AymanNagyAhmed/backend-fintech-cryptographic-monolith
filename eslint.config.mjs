// ESLint runs next to oxlint (npm run lint) for rules oxlint lacks:
// no-restricted-syntax here, eslint-plugin-boundaries in A-B14.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const MONEY = '/amount|balance|price/i';
const MESSAGE = 'Money must stay a decimal string or Money/Decimal; never convert it to a JS number (2.11).';

// The converted value as a plain name, a property (dto.amount) or an optional property (dto?.amount)
const moneyArg = (path) => [
  `[${path}.name=${MONEY}]`,
  `[${path}.property.name=${MONEY}]`,
  `[${path}.expression.property.name=${MONEY}]`,
];

const restricted = [
  ...moneyArg('arguments.0').map((m) => `CallExpression[callee.name=/^(parseFloat|parseInt|Number)$/]${m}`),
  ...moneyArg('arguments.0').map(
    (m) => `CallExpression[callee.object.name='Number'][callee.property.name=/^(parseFloat|parseInt)$/]${m}`,
  ),
  ...moneyArg('argument').map((m) => `UnaryExpression[operator='+']${m}`),
].map((selector) => ({ selector, message: MESSAGE }));

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'src/generated/'] },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-restricted-syntax': ['error', ...restricted],
    },
  },
);
