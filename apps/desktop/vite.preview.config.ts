import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Temporary harness: builds preview.html only, without the electron plugins.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  base: './',
  build: {
    outDir: 'dist-preview',
    rollupOptions: { input: path.resolve(process.cwd(), 'preview.html') },
  },
});
