import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'WsForm',
      fileName: () => 'ws-form.js',
      formats: ['iife'],
    },
    outDir: 'dist',
    minify: true,
    sourcemap: false,
  },
});
