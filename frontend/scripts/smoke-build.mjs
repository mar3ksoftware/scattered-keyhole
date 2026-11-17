import { globSync } from 'node:fs';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

// Every test file under src becomes its own SSR entry so `node --test` can
// run the bundle directly without a bundler-aware loader.
const inputs = [...globSync('src/**/*.test.ts'), ...globSync('src/**/*.test.tsx')].sort();
if (inputs.length === 0) {
  throw new Error('no test files found under src/');
}

await build({
  configFile: false,
  root: process.cwd(),
  plugins: [react()],
  logLevel: 'warn',
  build: {
    ssr: true,
    outDir: '.test-build',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: {
      input: inputs,
    },
  },
});
console.log(`built ${inputs.length} test file(s)`);
