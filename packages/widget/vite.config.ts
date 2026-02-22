import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'CrmForm',
      fileName: () => 'crm-form.js',
      formats: ['iife'],
    },
    outDir: 'dist',
    minify: true,
    sourcemap: false,
  },
});
