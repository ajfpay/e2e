/** An `agent.act` step reads with its params filled in, while every model keeps reading the instruction as written. */

import { describe, expect, it } from 'vitest';
import { actLabel } from '../../src/agent/act-label.ts';
import { validateParams } from '../../src/agent/act-validation.ts';
import { resolveConfig } from '../../src/config/resolve.ts';
import { defineEngine } from '../../src/engine/index.ts';
import { createEngineSession } from '../../src/engine/session.ts';
import { SecretLedger } from '../../src/internal/redact.ts';
import { Deadline } from '../../src/internal/time.ts';
import { unique } from '../../src/params.ts';
import { AttemptBudget } from '../../src/run/budget.ts';
import { createFixtures } from '../../src/run/fixtures.ts';
import { StepRecorder, type StepProgress } from '../../src/run/steps.ts';
import { WorkerModels } from '../../src/run/worker-models.ts';
import { secretHandle } from '../../src/secrets.ts';
import type { AgentParams, E2EConfig } from '../../src/types.ts';
import { runAgentStepsOnFakeTime } from '../helpers/agent-fake-time.ts';
import { installFakeLoopModel, loopCalls } from '../helpers/fake-loop-model.ts';
import { snapshot } from '../helpers/snapshot.ts';

runAgentStepsOnFakeTime();

/** The label `agent.act(instruction, { params })` records against the attempt's secret ledger. */
function label(instruction: string, params: AgentParams | undefined, ledger = new SecretLedger()): string {
  const { projected, secrets } = validateParams(params);
  return actLabel(instruction, projected, secrets, ledger);
}

describe('actLabel', () => {
  it('fills each {name} from the param it names', () => {
    expect(label('add a todo named {title}', { title: 'Buy milk' })).toBe('add a todo named Buy milk');
    expect(label('move {from} to {to}, then {from} again', { from: 'Inbox', to: 'Done' })).toBe(
      'move Inbox to Done, then Inbox again',
    );
  });

  it("shows a unique() value as this run's value", () => {
    expect(label('create a company named {name}', { name: unique('Acme 1734') })).toBe('create a company named Acme 1734');
  });

  it('shows a value that is not a string as its JSON', () => {
    expect(label('buy {count} seats, gift {gift}, coupon {coupon}', { count: 3, gift: true, coupon: null })).toBe(
      'buy 3 seats, gift true, coupon null',
    );
    expect(label('fill in {address}', { address: { city: 'Bend', lines: ['7 Pine Way'] } })).toBe(
      'fill in {"city":"Bend","lines":["7 Pine Way"]}',
    );
  });

  it('leaves a param that is or holds a Secret as {name}', () => {
    const password = secretHandle({ name: 'admin.password', purpose: 'password' });
    expect(label('sign in as {user} with {password}', { user: 'admin', password })).toBe('sign in as admin with {password}');
    expect(label('sign in as {account}', { account: { username: 'admin', password } })).toBe('sign in as {account}');
    expect(label('try {passwords}', { passwords: ['old', password] })).toBe('try {passwords}');
  });

  it('leaves a {name} no param has, and a value that spells another {name}, as written', () => {
    expect(label('type {"a":1} into {field}', { field: '{note}', note: 'x' })).toBe('type {"a":1} into {note}');
    expect(label('open {constructor} and {toString}', { title: 'x' })).toBe('open {constructor} and {toString}');
    expect(label('add {title}', undefined)).toBe('add {title}');
  });

  it('leaves double braces alone', () => {
    expect(label('upgrade to {{plan}} and {{param:/plan}}', { plan: 'Pro', 'param:/plan': 'Pro' })).toBe(
      'upgrade to {{plan}} and {{param:/plan}}',
    );
  });

  it('fills a key that is not an identifier', () => {
    expect(label('use {first name} and {admin.email}', { 'first name': 'Ada', 'admin.email': 'ada@example.test' })).toBe(
      'use Ada and ada@example.test',
    );
  });

  it('redacts the filled label whole: a value can finish a secret the instruction began', () => {
    const ledger = new SecretLedger([['probe', 'hunter2-secret']]);
    expect(label('type hunter2-{rest}', { rest: 'secret' }, ledger)).toBe('type <secret:probe>');
  });

  it('redacts the instruction before filling it: a secret it spells stays whole', () => {
    const ledger = new SecretLedger([['probe', 'pw{id}-horse']]);
    expect(label('type pw{id}-horse for user {id}', { id: 42 }, ledger)).toBe('type <secret:probe> for user 42');
  });

  it("leaves a {name} inside a secret's marker as written", () => {
    const ledger = new SecretLedger([['api{env}', 'sk_live_Zr8Kq2xx']]);
    expect(label('paste sk_live_Zr8Kq2xx for {env}', { env: 'prod' }, ledger)).toBe('paste <secret:api{env}> for prod');
  });

  it('bounds a label a long value grew to what a report step holds', () => {
    const filled = label('paste {essay} here', { essay: 'x'.repeat(10_000) });
    expect(filled).toHaveLength(8_192);
    expect(filled.endsWith('x…')).toBe(true);
  });

  it('redacts before the cut and never cuts a marker short', () => {
    const ledger = new SecretLedger([['probe', 'hunter2-secret']]);
    const filled = label('paste {essay}', { essay: `${'x'.repeat(8_180)}hunter2-secret` }, ledger);
    expect(filled.endsWith('x…')).toBe(true);
    expect(filled).not.toContain('hunt');
    expect(filled).not.toContain('<secr');
  });

  it('cuts a long label so redacting it again changes nothing, whatever the secret names spell', () => {
    const ledger = new SecretLedger([
      ['ops@acme.test.password', 'secret'],
      ['stripe/live key', 'sk_live_Zr8Kq2xx'],
    ]);
    for (let pad = 8_150; pad < 8_200; pad += 1) {
      const filled = label('paste {notes} then {key}', { notes: 'x'.repeat(pad), key: 'sk_live_Zr8Kq2xx' }, ledger);
      expect(filled.length).toBeLessThanOrEqual(8_192);
      expect(ledger.redact(filled)).toBe(filled);
    }
  });
});

/** A real fixture graph with an in-memory engine that hears every step's progress. */
function runtime(overrides: Partial<E2EConfig> = {}) {
  const engine = defineEngine({ name: 'fake', version: '1', spiVersion: 1, observe: async () => snapshot([]) });
  const model = installFakeLoopModel(() => [{ toolName: 'complete_step', input: { status: 'passed', summary: 'done' } }]);
  const config = resolveConfig(
    { targets: [{ name: 'fake', platform: 'custom', engine }], cache: 'off', agents: { default: { model } }, ...overrides },
    { projectRoot: process.cwd(), env: {} },
  );
  const signal = new AbortController().signal;
  const heard: StepProgress[] = [];
  const steps = new StepRecorder('attempt', { onProgress: (progress) => heard.push(progress) });
  const { fixtures } = createFixtures({
    config,
    target: config.targets[0]!,
    session: createEngineSession({ engine, targetName: 'fake' }),
    steps,
    budget: new AttemptBudget(signal, new Deadline(10_000)),
    runId: 'run',
    attemptId: 'attempt',
    attempt: { testId: 'test', attemptId: 'attempt', index: 0, signal, memory: new Map() },
    artifacts: { dir: '/tmp', register: () => 'artifact', link: () => 'artifact' },
    priorSteps: () => steps.completed(),
    agentContext: undefined,
    saveSession: undefined,
    models: new WorkerModels(() => {}),
  });
  return { fixtures, steps, heard };
}

describe('a dispatched agent.act', () => {
  it('reports the filled label and keeps the instruction as written for every model', async () => {
    const { fixtures, steps, heard } = runtime();
    await fixtures.agent.act('add a todo named {title}', { params: { title: 'Buy milk' } });
    await fixtures.agent.act('mark it done');

    expect(steps.all().map((step) => ({ label: step.label, instruction: step.instruction }))).toEqual([
      { label: 'add a todo named Buy milk', instruction: 'add a todo named {title}' },
      { label: 'mark it done', instruction: undefined },
    ]);
    expect(heard.filter((progress) => progress.phase === 'start')).toMatchObject([
      { label: 'add a todo named Buy milk' },
      { label: 'mark it done' },
    ]);
    expect(loopCalls[0]!.prompt).toContain('Execute this test step: add a todo named {title}');
    expect(loopCalls[0]!.prompt).toContain('Step parameters:\n{"title":"Buy milk"}');
    expect(loopCalls[1]!.prompt).toContain('1. agent.act passed :: add a todo named {title}');
    expect(loopCalls[1]!.prompt).not.toContain('Buy milk');
  });

  it("leaves a Secret's {name} whole when a secret value spells part of the Secret's projection", async () => {
    const { fixtures, steps } = runtime({
      credentials: { admin: { username: 'admin', password: 'secret' } },
      secrets: { apiPassword: async () => 'provided-Zr8Kq2' },
    });
    await fixtures.agent.act('sign in as {user} with {pw}, then enter {key}', {
      params: { user: 'admin', pw: secretHandle({ name: 'admin.password', purpose: 'password' }), key: secretHandle({ name: 'apiPassword', purpose: 'generic-secret' }) },
    });
    expect(steps.all()[0]!.label).toBe('sign in as admin with {pw}, then enter {key}');
  });

  it('keeps the recorded instruction within the report bound when redaction lengthens it', async () => {
    const { fixtures, steps } = runtime({ credentials: { admin: { username: 'admin', password: 'hunter22' } } });
    const long = `${'x'.repeat(8_170)} hunter22`;
    await fixtures.agent.act(long);
    await fixtures.agent.act(`add {title} ${long}`, { params: { title: 'Buy milk' } });

    const [plain, filled] = steps.all();
    expect(plain!.label.length).toBeLessThanOrEqual(8_192);
    expect(plain!.instruction).toBeUndefined();
    expect(filled!.label.length).toBeLessThanOrEqual(8_192);
    expect(filled!.instruction!.length).toBeLessThanOrEqual(8_192);
    expect(filled!.instruction!.startsWith('add {title} x')).toBe(true);
  });
});
