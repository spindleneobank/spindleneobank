import { fileURLToPath } from 'node:url';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { parseEnv } from './src/env.schema';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  // Fail the build/dev server on an invalid or missing environment (not under vitest, which sets test.env).
  if (mode !== 'test') parseEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  return {
    server: { host: true, port: 7000, strictPort: true, allowedHosts: true },
    // Hashed bundles go to /_app so /assets/* is only the unhashed public media (different cache policy).
    build: { assetsDir: '_app' },
    resolve: {
      alias: {
        '@spindle/shared': r('../src/shared'),
        '@': r('./src'),
      },
    },
    plugins: [
      tanstackStart({
        prerender: {
          enabled: true,
          crawlLinks: true,
          // Header/footer link to marketing pages that F0m/F0n add later; flip to true once all exist.
          failOnError: false,
          // Dashboard routes are not prerendered per page: they are served by the SPA shell below.
          filter: (page) => !(page.fromCrawl && page.path.startsWith('/dashboard')),
        },
        // Client-only shell for /dashboard/* (vercel.json rewrites to it).
        spa: {
          enabled: true,
          maskPath: '/dashboard',
          prerender: { outputPath: '/_shell', crawlLinks: false },
        },
      }),
      react(),
    ],
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
      env: {
        VITE_API_URL: 'http://127.0.0.1:7200',
        VITE_APP_URL: 'http://127.0.0.1:7000',
        VITE_CHAIN_ID: '4663',
        VITE_RPC_URL: 'http://127.0.0.1:7245',
        VITE_REOWN_PROJECT_ID: 'test',
        VITE_EXPLORER_URL: 'https://explorer.test',
        VITE_USDG_ADDRESS: '0x0000000000000000000000000000000000000001',
        VITE_PERMIT2_ADDRESS: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        VITE_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000002',
        VITE_STAKING_ADDRESS: '0x0000000000000000000000000000000000000003',
        VITE_CLAIMS_ADDRESS: '0x0000000000000000000000000000000000000004',
        VITE_VAULT_ADDRESS: '0x0000000000000000000000000000000000000005',
        VITE_SPDL_ADDRESS: '0x0000000000000000000000000000000000000006',
        VITE_NODE_IMAGE: 'spindle/node',
        VITE_API_MOCK: '1',
      },
    },
  };
});
