import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@service': path.resolve(__dirname, 'src/service'),
      '@presentation': path.resolve(__dirname, 'src/presentation'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    typecheck: {
      tsconfig: './tsconfig.json',
    },
  },
});
