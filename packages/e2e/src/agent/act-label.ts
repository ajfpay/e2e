/**
 * The label an agent step reads as in the terminal, the report, and the
 * trace pages: its instruction with each `{name}` that names a param filled
 * in, so `add a todo named {title}` reads `add a todo named Buy milk`. The
 * executor, its model, and the trace cache key keep the instruction as
 * written.
 */

import { isJsonArray } from '../internal/json-value.ts';
import type { SecretLedger } from '../internal/redact.ts';
import type { JsonValue, Secret } from '../types.ts';

/**
 * A `{name}` with no brace on either side, so `{{name}}` and the cache's
 * `{{param:...}}` read as written, and outside a `<secret:NAME>` marker,
 * which a `>` closes, so a secret's name reads as written too.
 */
const PLACEHOLDER = /(?<!<secret:[^>]*)(?<!\{)\{([^{}]+)\}(?!\})/gu;

/** The longest label or instruction a report step holds (report-v1 `step.label`, `step.instruction`). */
export const MAX_STEP_TEXT_CHARS = 8_192;

/**
 * The step's instruction with every `{name}` that names a top-level param
 * replaced by its value, in one pass, so a value that spells `{other}` reads
 * as written. A string reads as itself and any other value as its JSON. A
 * param that is or holds a `Secret` stays `{name}`, as does a `{name}` no
 * param has. Takes the step as given: the instruction is redacted before it
 * is filled, so a secret it spells stays whole, and the params after, so a
 * `Secret` is told apart before redaction can rewrite its name. The filled
 * text is redacted whole, since a value can finish a secret the instruction
 * began, and only then bounded, never inside a marker.
 */
export function actLabel(
  instruction: string,
  params: Readonly<Record<string, JsonValue>> | undefined,
  secrets: ReadonlyMap<string, Secret>,
  ledger: Pick<SecretLedger, 'redact' | 'redactBound'>,
): string {
  const redacted = ledger.redact(instruction);
  const filled =
    params === undefined
      ? redacted
      : redacted.replace(PLACEHOLDER, (placeholder, name: string) =>
          Object.hasOwn(params, name) && !holdsSecret(params[name]!, secrets) ? paramText(params[name]!) : placeholder,
        );
  return ledger.redactBound(filled, MAX_STEP_TEXT_CHARS);
}

/** How one param value reads inside a label. */
function paramText(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Whether `value` is, or holds at any depth, a `Secret` the params projected to `{ kind: 'secret', name, purpose }`. */
function holdsSecret(value: JsonValue, secrets: ReadonlyMap<string, Secret>): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (isJsonArray(value)) return value.some((entry) => holdsSecret(entry, secrets));
  if (value['kind'] === 'secret' && typeof value['name'] === 'string' && secrets.has(value['name'])) return true;
  return Object.values(value).some((entry) => holdsSecret(entry, secrets));
}
