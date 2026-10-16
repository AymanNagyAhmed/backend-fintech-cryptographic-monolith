import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    setupFiles: ['reflect-metadata'],
    coverage: {
      provider: 'v8',
      // A-B15.5: 80% on money, crypto and audit logic. Wiring (modules,
      // controllers, DTOs, queue processors/schedulers, CLI entry points) is
      // exercised by the e2e suite, not by unit coverage.
      include: [
        'src/common/money/**/*.ts',
        'src/common/crypto/**/*.ts',
        'src/modules/crypto/**/*.ts',
        'src/modules/audit/**/*.ts',
      ],
      exclude: [
        '**/*.spec.ts',
        '**/*.module.ts',
        '**/*.controller.ts',
        '**/*.cli.ts',
        '**/*.constants.ts',
        '**/*.provider.ts',
        '**/*.dto.ts',
        '**/dto/**',
        '**/jobs/**',
        '**/interfaces/**',
        '**/exceptions/**',
        '**/decorators/**',
      ],
      reporter: ['text-summary', 'text'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
