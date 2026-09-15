import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.benchmark.ts'],
    exclude: ['dist/**', 'node_modules/**', 'storage/**']
  }
});
