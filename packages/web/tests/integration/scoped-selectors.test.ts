/**
 * `locator.locator(selector)`: a CSS or XPath selector scoped to another
 * expression's matches resolves inside them, through Playwright's own
 * locator chain, and inside a frame when the scope sits in one.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LocatorExpression } from 'e2e/engine';
import { surfaceOf, web } from '../../src/index.ts';
import { ignoreTrace, noSecrets } from '../helpers/secrets.ts';

const FORM = (name: string) =>
  `<form aria-label="${name}"><input name="manifest" value="${name} manifest"><button>Save</button></form>`;
const FRAME_DOCUMENT = FORM('Framed');
const DOCUMENT =
  FORM('Upload') +
  FORM('Import') +
  `<iframe id="frame" title="frame" srcdoc="${FRAME_DOCUMENT.replace(/"/g, '&quot;')}"></iframe>`;

function form(name: string): LocatorExpression {
  return {
    kind: 'query',
    query: {
      kind: 'role',
      value: { kind: 'string', value: 'form', exact: true },
      name: { kind: 'string', value: name, exact: true },
    },
  };
}

describe('scoped selectors', () => {
  const engine = web({});
  const artifactsDir = mkdtempSync(path.join(tmpdir(), 'e2e-scoped-selectors-'));
  const signal = new AbortController().signal;
  const operation = { signal, timeoutMs: 5_000, runId: 'scoped', attemptId: 'attempt', origin: 'test' as const };
  const cleanup = { signal, timeoutMs: 30_000 };

  beforeAll(async () => {
    await engine.init!({ runId: 'scoped', targetName: 'fixture', projectRoot: process.cwd(), app: {}, env: {}, headed: false, workerSlot: 0, signal, log: () => undefined });
    await engine.startAttempt!({ attemptId: 'attempt', artifactsDir, signal, resolveSecret: noSecrets, ...ignoreTrace });
    await engine.session!.open!('about:blank', operation);
    const page = surfaceOf(engine)!.page();
    await page.setContent(DOCUMENT);
    await page.frameLocator('#frame').getByRole('button').waitFor();
  });

  afterAll(async () => {
    await engine.endAttempt!(cleanup);
    await engine.dispose!(cleanup);
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  const values = async (expression: LocatorExpression) =>
    (await engine.locate!(expression, operation)).map((node) => node.value);

  it('matches the selector only inside the scope', async () => {
    expect(await values({ kind: 'selector', selector: 'input[name=manifest]' })).toEqual(['Upload manifest', 'Import manifest']);
    expect(await values({ kind: 'selector', selector: 'input[name=manifest]', scope: form('Import') })).toEqual(['Import manifest']);
    expect(await values({ kind: 'selector', selector: '//input', scope: form('Upload') })).toEqual(['Upload manifest']);
  });

  it('evaluates XPath from each match, so .. reaches the parent as in Playwright', async () => {
    const parents = await engine.locate!({ kind: 'selector', selector: 'xpath=..', scope: form('Import') }, operation);
    expect(parents).toHaveLength(1);
    expect(parents[0]!.role).not.toBe('form');
  });

  it('scopes a query under a scoped selector, and a selector under a filtered scope', async () => {
    const button: LocatorExpression = {
      kind: 'query',
      query: { kind: 'role', value: { kind: 'string', value: 'button', exact: true } },
      scope: { kind: 'selector', selector: 'form[aria-label=Import]' },
    };
    expect((await engine.locate!(button, operation)).map((node) => node.name)).toEqual(['Save']);
    const filtered: LocatorExpression = {
      kind: 'filter',
      source: { kind: 'selector', selector: 'form' },
      has: { kind: 'selector', selector: 'input[value="Upload manifest"]' },
    };
    expect(await values({ kind: 'selector', selector: 'input', scope: filtered })).toEqual(['Upload manifest']);
  });

  it('resolves inside the frame its scope sits in', async () => {
    const framed: LocatorExpression = { kind: 'frame', selector: '#frame', source: form('Framed') };
    expect(await values({ kind: 'selector', selector: 'input', scope: framed })).toEqual(['Framed manifest']);
  });
});
