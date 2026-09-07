import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: 'electron/main.ts' },
      {
        entry: 'electron/preload.ts',
        onstart: (args) => args.reload(),
        // A sandboxed preload must be CommonJS, but the package is ESM, so the
        // bundle needs the explicit .cjs extension to escape that setting.
        vite: {
          build: {
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: 'preload.cjs' },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5273, strictPort: true },
});
