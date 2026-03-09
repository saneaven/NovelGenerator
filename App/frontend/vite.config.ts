import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDomain = process.env.APP_DOMAIN?.trim().replace(/^\.+/, '').toLowerCase();
const allowedHosts = Array.from(
  new Set(
    [
      'localhost',
      '127.0.0.1',
      appDomain,
      appDomain ? `www.${appDomain}` : undefined,
    ].filter((host): host is string => Boolean(host)),
  ),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    allowedHosts,
  },
  preview: {
    allowedHosts,
  },
});
