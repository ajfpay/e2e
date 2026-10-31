import type { E2EConfig } from '../../packages/e2e/dist/index.js';
import { web } from '../../packages/web/dist/index.js';

export default {
  // Restrict to the suara file so a bare `e2e run` does not collect the
  // example's greeter tests, which this app does not serve.
  tests: ['tests/suara-lapangan.e2e.ts'],
  targets: [
    {
      engine: web(),
      app: {
        url: process.env.SUARA_APP_URL ?? 'http://localhost:3000',
      },
    },
  ],
} satisfies E2EConfig;
