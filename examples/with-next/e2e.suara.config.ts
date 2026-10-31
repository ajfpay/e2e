import type { E2EConfig } from '../../packages/e2e/dist/index.js';
import { web } from '../../packages/web/dist/index.js';

export default {
  targets: [
    {
      engine: web(),
      app: {
        url: process.env.SUARA_APP_URL ?? 'http://localhost:3000',
      },
    },
  ],
} satisfies E2EConfig;
