import { execFileSync } from 'node:child_process';

import { test } from '../../../packages/web/dist/index.js';
import { expect } from '../../../packages/e2e/dist/index.js';

/**
 * Creates a valid 16 kHz mono 16-bit PCM WAV as base64.
 * Produces exactly 32 044 bytes for a 1.0s tone, matching the K1 sample fixture format.
 */
function createPcmWavBase64(durationSeconds = 1, sampleRate = 16000): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSeconds;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    view.setInt16(44 + i * 2, sample, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// ─────────────────────────────────────────────────────────────────────────────
// Turns-store seeding, so a test that needs a session creates its own
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The speech the document model path is proved against. English, priced and
 * contextual, so Muse Spark has something to extract rather than nothing.
 */
const SEEDED_TURNS = [
  {
    startMs: 0,
    endMs: 5200,
    transcript:
      'Drywall for the living room, twenty-four square feet at twenty-five dollars a square foot.',
  },
  {
    startMs: 5400,
    endMs: 8200,
    transcript: "This is for Mr. Carter's place in Austin, Texas.",
  },
];

/**
 * A session id for one run, matching the app's `^[A-Za-z0-9_-]{1,64}$`.
 *
 * Unique per run on purpose: a fixed id would let a row seeded by hand satisfy
 * the route's store lookup, which is exactly the hidden dependency this test
 * must not have.
 */
function uniqueSessionId(prefix: string): string {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${run}`;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Runs one SQL statement through `psql` against the app's own database.
 *
 * The connection string is split into `PG*` variables rather than passed as an
 * argument, so it never reaches an argument list, a log line, or an error
 * message.
 */
function runSql(sql: string): void {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required: this test creates its session through the app turns store'
    );
  }

  const url = new URL(connectionString);
  execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], {
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
      PGSSLMODE:
        url.searchParams.get('sslmode') ?? process.env.PGSSLMODE ?? 'prefer',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Creates one session and its turns the way `saveTranscription` in
 * `lib/server/db/store.ts` writes them: one session row plus one row per turn,
 * `turn_index` counting from 1, because `turn_N` is what a document cites.
 */
function seedSession(sessionId: string): void {
  const transcript = SEEDED_TURNS.map((turn) => turn.transcript).join(' ');
  const turns = SEEDED_TURNS.map(
    (turn, index) =>
      `(${sqlLiteral(sessionId)}, ${index + 1}, ${turn.startMs}, ${turn.endMs}, ${sqlLiteral(turn.transcript)}, true)`
  ).join(',\n            ');

  runSql(`
        insert into sessions
            (id, locale, audio_sha256, audio_bytes, meta_session_id, transcript, audio_duration_ms, updated_at)
        values
            (${sqlLiteral(sessionId)}, 'en', ${sqlLiteral(`e2e-${sessionId}`)}, 32044, 'e2e-seeded', ${sqlLiteral(transcript)}, 8200, now());

        insert into turns (session_id, turn_index, start_ms, end_ms, transcript, final)
        values
            ${turns};
    `);
}

/** Removes the seeded session; its turns go with it (`on delete cascade`). */
function deleteSession(sessionId: string): void {
  runSql(`delete from sessions where id = ${sqlLiteral(sessionId)};`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing smoke tests
// ─────────────────────────────────────────────────────────────────────────────

test('renders rekam page in english by default', async ({ app, screen }) => {
  await app.open('/en/rekam');
  await expect(screen.getByRole('heading', { name: 'Rekam' })).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Work items' })).toBeVisible();
});

test('renders rekam page in indonesian', async ({ app, screen }) => {
  await app.open('/id/rekam');
  await expect(screen.getByRole('heading', { name: 'Rekam' })).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Item pekerjaan' })).toBeVisible();
});

test('navigates to susun and dokumen steps', async ({ app, screen }) => {
  await app.open('/en/susun');
  await expect(screen.getByRole('heading', { name: 'Susun' })).toBeVisible();

  await app.open('/en/dokumen');
  await expect(screen.getByRole('heading', { name: 'Dokumen' })).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 (a) POST /api/documents model-path verification
// ─────────────────────────────────────────────────────────────────────────────

test('POST /api/documents succeeds through the real model path and not fallback', async ({ browser }) => {
  await browser.goto('/en/rekam');

  const wavBase64 = createPcmWavBase64(1);

  // Probe (i): server is keyed (MODEL_API_KEY is configured).
  // POST /api/asr/transcribe with small 16 kHz mono WAV must NOT answer code "not_configured" (HTTP 503).
  const probeResult = await browser.evaluate(async (b64) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const formData = new FormData();
    formData.append('sessionId', 'probe-key-session');
    formData.append('locale', 'en');
    formData.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'sample.wav');

    const res = await fetch('/api/asr/transcribe', { method: 'POST', body: formData });
    let data: any = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  }, wavBase64);

  expect(probeResult.data?.error?.code).not.toBe('not_configured');

  // Probe (ii): call POST /api/documents for a session with speech turns.
  //
  // This test creates that session itself, through the same turns store the
  // route reads (see seedSession above), under an id no earlier run used. It
  // therefore depends on no row seeded by hand, and leaves none behind.
  const sessionId = uniqueSessionId('e2e-doc-model');

  try {
    // The id is new, so the route cannot find it before this test seeds it.
    // This is what makes the run self-sufficient rather than lucky.
    const unseeded = await browser.evaluate(async (sid) => {
      const res = await fetch(`/api/sessions/${sid}/turns`);
      return res.status;
    }, sessionId);
    expect(unseeded).toBe(404);

    seedSession(sessionId);

    const docResult = await browser.evaluate(async (sid) => {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          locale: 'en',
        }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {}
      return { status: res.status, data };
    }, sessionId);

    // Must return HTTP 200, not 502/503
    expect(docResult.status).toBe(200);
    expect(docResult.data?.document).toBeDefined();

    const doc = docResult.data.document;
    expect(Array.isArray(doc.pekerjaan)).toBe(true);
    expect(doc.pekerjaan.length).toBeGreaterThan(0);

    // Citation isolation: all sumber_kutipan must cite valid session turns
    const turnsResult = await browser.evaluate(async (sid) => {
      const res = await fetch(`/api/sessions/${sid}/turns`);
      return res.json();
    }, sessionId);

    // The turns the route read are this test's own seeded turns.
    expect(turnsResult.sessionId).toBe(sessionId);
    expect(turnsResult.turns?.length).toBe(SEEDED_TURNS.length);

    const validTurnIds = new Set(
      (turnsResult.turns || []).map((t: any) => t.turn_id)
    );
    for (const item of doc.pekerjaan) {
      expect(validTurnIds.has(item.sumber_kutipan)).toBe(true);
    }

    // Reliable discriminator:
    // When no project is supplied in the request body, extractCandidateFromTurns (deterministic fallback)
    // always assigns hardcoded defaults: { nama: "Proyek Lapangan", lokasi: "Lokasi Proyek", klien: "Klien" }.
    // In contrast, Muse Spark extracts or synthesizes context-driven project details.
    expect(doc.proyek?.nama).not.toBe('Proyek Lapangan');

    // Residual hole:
    // If MODEL_API_KEY is configured but the model fetch encounters an upstream network error
    // (err.code === "upstream_unreachable"), /api/documents catches SparkError and executes
    // documentFromTurns fallback returning HTTP 200 without caching in docStore.
    // The probe above guarantees the API key is present, but an upstream network outage
    // cannot be distinguished from a healthy model response without inspecting server logs or project/uraian heuristics.
  } finally {
    // Nothing later runs depend on: drop the session this test created.
    deleteSession(sessionId);
  }

  // The cleanup really happened, so a repeat run starts where this one did.
  const afterCleanup = await browser.evaluate(async (sid) => {
    const res = await fetch(`/api/sessions/${sid}/turns`);
    return res.status;
  }, sessionId);
  expect(afterCleanup).toBe(404);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 (b) Citation audio playback on susun page
// ─────────────────────────────────────────────────────────────────────────────

test('citation audio playback on the susun page toggles stop audio', async ({ browser, screen }) => {
  const sessionId = 'sess-citation-audio-1';
  const wavBase64 = createPcmWavBase64(1);

  // Route GET /api/sessions/${sessionId}/turns to provide a valid turn
  await browser.route(new RegExp(`/api/sessions/${sessionId}/turns`), async (route) => {
    await route.fulfill({
      json: {
        sessionId,
        locale: 'en',
        turns: [
          {
            turn_id: 'turn_1',
            startMs: 0,
            endMs: 1000,
            transcript: '100 square meters of wall plastering at 50 dollars per meter',
            final: true,
          },
        ],
      },
    });
  });

  // Navigate to domain first to access origin IndexedDB
  await browser.goto('/en/susun');

  // Seed browser IndexedDB "suara-lapangan", store "recordings" with 16 kHz mono PCM WAV
  await browser.evaluate(async ({ sid, b64 }) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/wav' });

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('suara-lapangan', 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('recordings')) {
          db.createObjectStore('recordings', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('recordings', 'readwrite');
        const store = tx.objectStore('recordings');
        store.put({
          id: `rec-${sid}`,
          sessionId: sid,
          blob,
          createdAt: Date.now(),
          status: 'completed',
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      req.onerror = () => reject(req.error);
    });
    return null;
  }, { sid: sessionId, b64: wavBase64 });

  // Open susun with target sessionId
  await browser.goto(`/en/susun?sessionId=${sessionId}`);

  // Locate turn-card-1
  const turnCard = screen.getByTestId('turn-card-1');
  await expect(turnCard).toBeVisible();

  // Click Quote 1 control
  const quoteControl = turnCard.getByRole('button', { name: /Quote 1/i });
  await expect(quoteControl).toBeVisible();
  await quoteControl.click();

  // Assert Stop audio control appears
  const stopControl = turnCard.getByRole('button', { name: /Stop audio/i });
  await expect(stopControl).toBeVisible();

  // Click Stop audio and assert return to idle Quote 1 state without error alert
  await stopControl.click();
  await expect(turnCard.getByRole('button', { name: /Quote 1/i })).toBeVisible();
  // Scope to the turn card: Next.js' __next-route-announcer__ is a persistent
  // role="alert" element outside the card and must not count as an error.
  // The card's own "audio unavailable" alert must not be visible after Stop.
  await expect(turnCard.getByRole('alert')).not.toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 (c) No English fallback text on Indonesian susun page
// ─────────────────────────────────────────────────────────────────────────────

test('no English fallback text leaks on the Indonesian susun page empty state', async ({ app, screen }) => {
  await app.open('/id/susun');

  // Assert Indonesian empty state text is rendered
  await expect(screen.getByText('Belum ada item pekerjaan')).toBeVisible();
  await expect(screen.getByText(/Belum ada rekaman untuk disusun/i)).toBeVisible();

  // Assert known English fallback strings do NOT leak
  await expect(screen.getByText('No recording to assemble yet')).not.toBeVisible();
  await expect(screen.getByText(/Go to Step 1/i)).not.toBeVisible();
  await expect(screen.getByText(/Session ID manually/i)).not.toBeVisible();

  // Assert manual entry placeholder does not leak English 'e.g. sess-123'
  const leakedPlaceholder = screen.getByPlaceholder('e.g. sess-123');
  await expect(leakedPlaceholder).not.toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Also keep covered
// ─────────────────────────────────────────────────────────────────────────────

test('three-step shell navigation and stepper indicators', async ({ app, screen, browser }) => {
  // Step 1: Rekam
  await app.open('/en/rekam');
  await expect(screen.getByRole('link', { name: /01.*Rekam/i })).toHaveAttribute('aria-current', 'step');

  // Walk Next -> Step 2: Susun
  await screen.getByRole('link', { name: /Next: Susun/i }).click();
  await expect(browser).toHaveURL(/\/en\/susun/);
  await expect(screen.getByRole('link', { name: /02.*Susun/i })).toHaveAttribute('aria-current', 'step');

  // Walk Next -> Step 3: Dokumen
  await screen.getByRole('link', { name: /Next: Dokumen/i }).click();
  await expect(browser).toHaveURL(/\/en\/dokumen/);
  await expect(screen.getByRole('link', { name: /03.*Dokumen/i })).toHaveAttribute('aria-current', 'step');

  // Walk Previous -> Step 2: Susun
  await screen.getByRole('link', { name: /Previous: Susun/i }).click();
  await expect(browser).toHaveURL(/\/en\/susun/);
  await expect(screen.getByRole('link', { name: /02.*Susun/i })).toHaveAttribute('aria-current', 'step');

  // Walk Previous -> Step 1: Rekam
  await screen.getByRole('link', { name: /Previous: Rekam/i }).click();
  await expect(browser).toHaveURL(/\/en\/rekam/);
  await expect(screen.getByRole('link', { name: /01.*Rekam/i })).toHaveAttribute('aria-current', 'step');
});

test('locale switching EN <-> ID keeps the current step and translates copy', async ({ app, screen, browser }) => {
  await app.open('/en/susun');
  await expect(screen.getByRole('heading', { name: 'Susun' })).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Assemble the work list' })).toBeVisible();

  // Switch to Indonesian
  await screen.getByRole('button', { name: /Bahasa Indonesia/i }).click();
  await expect(browser).toHaveURL(/\/id\/susun/);
  await expect(screen.getByRole('heading', { name: 'Susun' })).toBeVisible();
  await expect(screen.getByRole('heading', { name: 'Susun daftar pekerjaan' })).toBeVisible();

  // Switch back to English
  await screen.getByRole('button', { name: /English/i }).click();
  await expect(browser).toHaveURL(/\/en\/susun/);
  await expect(screen.getByRole('heading', { name: 'Assemble the work list' })).toBeVisible();
});

test('record hold guard prevents presses shorter than 0.3s and triggers on at least 0.3s', async ({ app, screen, browser }) => {
  await app.open('/en/rekam');

  // Mock getUserMedia in page so media permission / hardware is deterministic
  await browser.evaluate(() => {
    if (!navigator.mediaDevices) {
      (navigator as any).mediaDevices = {};
    }
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dst = ctx.createMediaStreamDestination();
      osc.connect(dst);
      osc.start();
      return dst.stream;
    };
    return null;
  });

  // Short press: 100ms (< 300ms)
  await browser.evaluate(() => {
    const btn = document.querySelector('[data-testid="record-button"]');
    if (!btn) throw new Error('record-button not found');
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    setTimeout(() => {
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, 100);
    return null;
  });

  // Wait 400ms to verify 300ms hold threshold was not triggered
  await browser.evaluate(() => new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)));
  await expect(screen.getByTestId('record-duration')).not.toBeVisible();

  // Long press: 350ms (>= 300ms)
  await browser.evaluate(() => {
    const btn = document.querySelector('[data-testid="record-button"]');
    if (!btn) throw new Error('record-button not found');
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    setTimeout(() => {
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, 350);
    return null;
  });

  // Recording starts after holding >= 0.3s
  await expect(screen.getByTestId('record-duration')).toBeVisible();
});

test('rate limiting returns 429 with Retry-After on 31 requests within a minute', async ({ browser }) => {
  await browser.goto('/en/rekam');

  // The browser's own bucket may already be partly used by an earlier test in
  // this run, so probe the live counters and drive exactly to the boundary
  // instead of assuming a fresh bucket.
  const result = await browser.evaluate(async () => {
    const probe = new FormData();
    probe.append('sessionId', `ratelimit-probe-${Date.now()}`);
    probe.append('locale', 'en');
    const probeRes = await fetch('/api/asr/transcribe', {
      method: 'POST',
      body: probe,
    });

    const limit = Number(probeRes.headers.get('x-ratelimit-limit'));
    const remaining = Number(probeRes.headers.get('x-ratelimit-remaining'));

    const drain: number[] = [];
    for (let i = 0; i < remaining; i++) {
      const form = new FormData();
      form.append('sessionId', `ratelimit-sess-${i}`);
      form.append('locale', 'en');
      const res = await fetch('/api/asr/transcribe', {
        method: 'POST',
        body: form,
      });
      drain.push(res.status);
    }

    const over = new FormData();
    over.append('sessionId', `ratelimit-over-${Date.now()}`);
    over.append('locale', 'en');
    const overRes = await fetch('/api/asr/transcribe', {
      method: 'POST',
      body: over,
    });

    return {
      probeStatus: probeRes.status,
      limit,
      remaining,
      drain,
      overStatus: overRes.status,
      retryAfter: overRes.headers.get('retry-after'),
      overRemaining: overRes.headers.get('x-ratelimit-remaining'),
    };
  });

  if (result.probeStatus === 429) {
    throw new Error(
      'rate limit bucket was already exhausted before this test started; ' +
        'cannot measure the boundary. Rerun after the 60s window resets.'
    );
  }

  const used = result.limit - result.remaining;
  expect(Number.isInteger(used)).toBe(true);
  expect(used).toBeGreaterThanOrEqual(1);
  expect(used).toBeLessThanOrEqual(result.limit);

  // Every request up to the limit is allowed; a 400 for the missing audio part
  // is expected and fine.
  for (const status of result.drain) {
    expect(status).not.toBe(429);
  }

  expect(result.overStatus).toBe(429);
  expect(Number.parseInt(result.retryAfter ?? '', 10)).toBeGreaterThan(0);
  expect(result.overRemaining).toBe('0');
});

test('dead invoice routes answer 404 or 405', async ({ browser }) => {
  await browser.goto('/en/rekam');

  const deadRoutes = [
    '/api/invoice/generate',
    '/api/invoice/send',
    '/api/invoice/export',
    '/api/invoice/warm',
  ];

  const statuses = await browser.evaluate(async (routes) => {
    const results: Record<string, number> = {};
    for (const route of routes) {
      const res = await fetch(route, { method: 'POST' });
      results[route] = res.status;
    }
    return results;
  }, deadRoutes);

  for (const route of deadRoutes) {
    expect([404, 405]).toContain(statuses[route]);
  }
});

test('unknown locale routes /en/guide and /en/az answer 404', async ({ browser }) => {
  await browser.goto('/en/rekam');

  const statuses = await browser.evaluate(async () => {
    const guideRes = await fetch('/en/guide');
    const azRes = await fetch('/en/az');
    return {
      guide: guideRes.status,
      az: azRes.status,
    };
  });

  expect(statuses.guide).toBe(404);
  expect(statuses.az).toBe(404);
});
