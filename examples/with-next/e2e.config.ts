import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { gateway } from 'ai';

export default {
  // tests/suara-lapangan.e2e.ts drives another app and needs its own
  // credentials, so it runs from e2e.suara.config.ts, not from this one.
  tests: ['tests/**/*.e2e.ts', '!tests/suara-lapangan.e2e.ts'],
  // The Vercel AI Gateway serves the model and reads AI_GATEWAY_API_KEY.
  // Only tests that use `agent` need it; tests/deterministic.e2e.ts runs without one.
  agents: {
    default: {
      model: gateway('openai/gpt-6-luna-fast'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    },
  },
  targets: [
    {
      engine: web(),
      app: {
        url: 'http://localhost:3100',
        // The runner starts the Next.js dev server and waits for the URL to answer.
        // A server you already started on that port is reused.
        command: { executable: 'npm', args: ['run', 'dev'], reuseExisting: true },
      },
    },
  ],
} satisfies E2EConfig;
