/**
 * `locator.locator(selector)`: core scopes a selector expression under the
 * locator's own, and the engine resolves it with its selector language. The
 * fake engine reads `name=<value>` against a node's test id.
 */

import { describe, expect, it } from 'vitest';
import { resolveExpression, type LocatorExpression, type SemanticNode } from '../../src/engine/index.ts';
import { screenOver } from '../helpers/screen-over.ts';
import { snapshot } from '../helpers/snapshot.ts';

function form(id: string): SemanticNode {
  return {
    ref: { id, revision: '' },
    role: 'form',
    name: id,
    children: [{ ref: { id: `${id}-manifest`, revision: '' }, role: 'textbox', testId: 'manifest', value: `${id} manifest` }],
  };
}

const FORMS: readonly SemanticNode[] = [form('Upload'), form('Import')];

const byTestId = (selector: string, candidates: readonly SemanticNode[]): SemanticNode[] =>
  candidates.filter((candidate) => `name=${candidate.testId ?? ''}` === selector);

/** A screen over two forms, logging every expression its engine is asked to locate. */
function formScreen({ selector = byTestId, scopedSelectors = true }: { selector?: typeof byTestId | null; scopedSelectors?: boolean } = {}) {
  const expressions: LocatorExpression[] = [];
  const { screen } = screenOver({
    observe: () => snapshot(FORMS),
    locate: (expression) => {
      expressions.push(expression);
      return resolveExpression(expression, FORMS, selector === null ? {} : { selector });
    },
    scopedSelectors,
    timeoutMs: 50,
  });
  return { screen, expressions };
}

describe('locator.locator', () => {
  it("matches the selector inside the locator's matches only", async () => {
    const { screen, expressions } = formScreen();
    expect(await screen.getByRole('form', { name: 'Import' }).locator('name=manifest').inputValue()).toBe('Import manifest');
    expect(expressions.at(-1)).toEqual({ kind: 'selector', selector: 'name=manifest', scope: expect.objectContaining({ kind: 'query' }) });
    expect(await screen.getByRole('form').locator('name=manifest').count()).toBe(2);
  });

  it('chains further queries and stays strict, naming the whole chain', async () => {
    const { screen } = formScreen();
    expect(await screen.getByRole('form').locator('name=manifest').filter({ hasText: 'Upload' }).inputValue()).toBe('Upload manifest');
    await expect(screen.getByRole('form').locator('name=manifest').inputValue()).rejects.toMatchObject({
      code: 'LOCATOR_AMBIGUOUS',
      message: expect.stringContaining('getByRole("form") >> locator("name=manifest")'),
    });
  });

  it('refuses an empty selector before any engine call', () => {
    const { screen, expressions } = formScreen();
    expect(() => screen.getByRole('form').locator('')).toThrow(expect.objectContaining({ code: 'INVALID_LOCATOR' }));
    expect(expressions).toEqual([]);
  });

  it('is UNSUPPORTED_CAPABILITY on a target without a selector language', async () => {
    const { screen } = formScreen({ selector: null });
    await expect(screen.getByRole('form').locator('name=manifest').count()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
  });

  it('is UNSUPPORTED_CAPABILITY, before the engine sees it, when the engine does not declare scopedSelectors', async () => {
    const { screen, expressions } = formScreen({ scopedSelectors: false });
    const scoped = screen.getByRole('form', { name: 'Import' }).locator('name=manifest');
    await expect(scoped.count()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY', message: expect.stringContaining('scoped') });
    await expect(screen.getByRole('textbox').filter({ has: scoped }).count()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(expressions).toEqual([]);
    expect(await screen.getByRole('form').getByRole('textbox').count()).toBe(2);
  });
});
