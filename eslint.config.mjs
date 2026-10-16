// ESLint runs next to oxlint (npm run lint) for rules oxlint lacks:
// no-restricted-syntax here, eslint-plugin-boundaries (A-B14.1) for module boundaries.
import boundaries from 'eslint-plugin-boundaries';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const MONEY = '/amount|balance|price/i';
const MESSAGE =
  'Money must stay a decimal string or Money/Decimal; never convert it to a JS number (2.11).';

// The converted value as a plain name, a property (dto.amount) or an optional property (dto?.amount)
const moneyArg = (path) => [
  `[${path}.name=${MONEY}]`,
  `[${path}.property.name=${MONEY}]`,
  `[${path}.expression.property.name=${MONEY}]`,
];

const restricted = [
  ...moneyArg('arguments.0').map(
    (m) => `CallExpression[callee.name=/^(parseFloat|parseInt|Number)$/]${m}`,
  ),
  ...moneyArg('arguments.0').map(
    (m) =>
      `CallExpression[callee.object.name='Number'][callee.property.name=/^(parseFloat|parseInt)$/]${m}`,
  ),
  ...moneyArg('argument').map((m) => `UnaryExpression[operator='+']${m}`),
].map((selector) => ({ selector, message: MESSAGE }));

// A-B14.1: no `index.ts` barrels (nestjs-file-structure.mdc), so a module's public surface is
// a set of files by folder / suffix instead of one entry point. Another module may import only
// these; everything else in `src/modules/<name>/` is private to that module.
const PUBLIC_MODULE_FILES = [
  '*.module.ts',
  '**/*.service.ts',
  'dto/**',
  'exceptions/**',
  'interfaces/**',
  'decorators/**',
  'events/**',
  'guards/**',
];

const boundariesRules = {
  default: 'disallow',
  message:
    'Module boundary: import another module only through its *.module.ts, *.service.ts, dto/, exceptions/, interfaces/, decorators/, events/ or guards/ files, or with `import type` (A-B14.1).',
  policies: [
    // Platform layers never depend on feature modules.
    {
      from: {
        element: { type: ['common', 'config', 'database', 'shared-kernel'] },
      },
      allow: {
        to: {
          element: {
            type: [
              'common',
              'config',
              'database',
              'shared-kernel',
              'generated',
            ],
          },
        },
      },
    },
    // A module uses the platform layers freely and other modules only via their public files.
    {
      from: { element: { type: 'module' } },
      allow: {
        to: [
          {
            element: {
              type: [
                'common',
                'config',
                'database',
                'shared-kernel',
                'generated',
              ],
            },
          },
          {
            element: {
              type: 'module',
              captured: { name: '{{ from.element.captured.name }}' },
            },
          },
          {
            element: { type: 'module', fileInternalPath: PUBLIC_MODULE_FILES },
          },
        ],
      },
    },
    // Type-only imports (AuthUser, OutboxContext, SignatureEnvelope, ...) add no runtime coupling.
    {
      from: { element: { type: 'module' } },
      allow: {
        to: { element: { type: 'module' } },
        dependency: { kind: 'type' },
      },
    },
    // The composition root wires everything.
    {
      from: { file: { categories: 'app' } },
      allow: {
        to: [{ element: { type: '*' } }, { file: { categories: 'app' } }],
      },
    },
  ],
};

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
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'module', pattern: 'src/modules/*', capture: ['name'] },
        { type: 'common', pattern: 'src/common' },
        { type: 'config', pattern: 'src/config' },
        { type: 'database', pattern: 'src/database' },
        { type: 'generated', pattern: 'src/generated' },
        { type: 'shared-kernel', pattern: 'src/shared-kernel' },
      ],
      // Composition root: src/main.ts, src/app.module.ts, ...
      'boundaries/files': [{ category: 'app', pattern: 'src/*.ts' }],
      // `./x.js` imports live on disk as `x.ts`
      'import/resolver': { './scripts/eslint-ts-resolver.cjs': {} },
    },
    rules: {
      'boundaries/dependencies': ['error', boundariesRules],
    },
  },
);
