import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests run inside workerd rather than Node, so `caches`, `btoa`, `crypto.subtle`
 * and `AbortSignal.timeout` behave exactly as they do in production - which
 * matters here, because the token encryption and the Firebase JWT signing are
 * both WebCrypto.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
});
