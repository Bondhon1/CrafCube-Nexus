import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: 'electron/main.ts' },
      {
        entry: 'electron/preload.ts',
        onstart: (args) => args.reload(),
      },
    ]),
    renderer(),
  ],
  resolve: {
    // Resolved from the package directory, which is vite's cwd.
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: { port: 5273, strictPort: true },
});
