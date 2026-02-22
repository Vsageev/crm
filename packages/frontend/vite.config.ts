import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function loadCerts() {
  const certPath = path.resolve(__dirname, '../../certs/localhost.pem');
  const keyPath = path.resolve(__dirname, '../../certs/localhost-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }
  return undefined;
}

const https = loadCerts();
const backendUrl = process.env.VITE_API_URL ?? (https ? 'https://localhost:3000' : 'http://localhost:3000');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    ...(https ? { https } : {}),
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        secure: false, // allow self-signed certs in dev
      },
    },
  },
});
