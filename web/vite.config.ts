import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import path from 'node:path';

// The engine in ../src is CommonJS, written for Node. Two lines make it run in
// a browser instead: transform its require/module.exports, and point the one
// Node-only import it has (the native SQLite driver) at a stub, because the
// browser build supplies its own database through src/engine/sqljs.ts.
const engineDir = path.resolve(__dirname, '../src');

export default defineConfig({
  // Relative, so one build works both at a GitHub Pages sub-path and at the
  // root of the Node service, which serves this same directory.
  base: './',
  plugins: [viteCommonjs(), react()],
  resolve: {
    alias: {
      'better-sqlite3': path.resolve(__dirname, 'src/engine/no-native-sqlite.ts'),
      '@engine': engineDir,
    },
  },
  optimizeDeps: { exclude: ['sql.js'] },
  build: {
    outDir: '../docs',
    emptyOutDir: false,
    target: 'es2020',
    // The engine is CommonJS and lives outside this package, so Rollup has to
    // be told to convert it as well as the dependencies.
    commonjsOptions: { include: [/node_modules/, /\/src\//], transformMixedEsModules: true },
  },
  test: { environment: 'jsdom', globals: true, css: false, setupFiles: './src/test/setup.ts' },
});
