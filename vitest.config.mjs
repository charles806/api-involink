import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 20000,
    setupFiles: ['./tests/setup.mjs'],
    include: ['src/**/*.test.js', 'src/**/__tests__/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/index.js'],
      thresholds: {
        lines: 40,
        functions: 40,
        statements: 40,
      },
    },
  },
});