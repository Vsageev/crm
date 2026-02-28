import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/chat/index.ts',
      name: 'WsChat',
      fileName: () => 'ws-chat.js',
      formats: ['iife'],
    },
    outDir: 'dist',
    minify: true,
    sourcemap: false,
    emptyOutDir: false,
  },
});
