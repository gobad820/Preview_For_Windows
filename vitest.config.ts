import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
  resolve: {
    // pdf.js needs its legacy build to run under Node (no DOM, fake worker).
    alias: { 'pdfjs-dist': 'pdfjs-dist/legacy/build/pdf.mjs' },
  },
});
