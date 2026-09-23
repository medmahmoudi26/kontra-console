/**
 * The values a form has collected, as the units a probe takes.
 *
 * WHAT RIDES IN THE ARGUMENT IS A REF, NEVER THE BYTES. A Method's input is a workflow argument and
 * a workflow argument is replayed on every worker that picks the run up; a 40 MB corpus there is
 * refused outright or offloaded by the claim-check codec on the way past. So an upload happens ONCE,
 * before the run starts, and `{name, sha256, size}` is what travels.
 *
 * AN EMPTY STRING IS NOT A VALUE. A box somebody tabbed through and left blank must omit its key, or
 * the author's default is silently replaced by `''` — which for a `Literal` field is not even a
 * legal value. `undefined` and `''` are both absence; `false` is not.
 */
import { coerceField } from '@kontra/console-core/panels/formFields';

export interface BlobRef {
  name: string;
  sha256: string;
  size: number;
  path?: string;
}

export type FieldValue = string | boolean | BlobRef | { files: BlobRef[] } | undefined;

/**
 * The form's values as the payload a run is started with.
 *
 * ── TYPES ARE APPLIED HERE, AND LEAVING THEM OFF MADE EVERY NUMERIC WORKFLOW UNLAUNCHABLE ──────
 *
 * An HTML input holds a STRING. Passed through verbatim, a declared `machines: int` leaves the
 * browser as `"2"`, and Temporal's converter refuses it on the way into the workflow:
 *
 *     TypeError: Failed converting value for key 'machines' in mapping <class 'SurfaceInput'>
 *     RuntimeError: Failed decoding arguments
 *
 * which the worker reports as a failed workflow task — so the run sits at RUNNING, never advances,
 * and a subscriber sees the thoroughly unhelpful `Workflow Update failed`. It applies to every
 * workflow in the catalog with an `int` or `float` input, which is all of them.
 *
 * `coerceField` already existed and was already tested; it was wired into the actor DISPATCH path
 * (`methodCall.ts`) and never into this one. `types` is optional so the dev pane's untyped use
 * keeps working — absent, this behaves exactly as it did.
 */
export function payloadOf(
  values: Record<string, FieldValue>,
  types?: ReadonlyMap<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === '') continue;
    const declared = types?.get(k);
    if (declared !== undefined && typeof v === 'string') {
      const coerced = coerceField(declared, v);
      // A VALUE THAT WILL NOT COERCE IS LEFT AS THE STRING IT IS, not dropped. `missing()` and the
      // per-field error the form already renders are what tell somebody about it; silently
      // omitting the key would start the run with the author's default instead of what was typed,
      // which is the worse of the two wrong answers.
      out[k] = 'value' in coerced ? coerced.value : v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Which required fields are still absent. Named, because "invalid" is not an actionable message. */
export function missing(required: readonly string[], payload: Record<string, unknown>): string[] {
  return required.filter((k) => payload[k] === undefined);
}

/**
 * Bring a form's values in line with the fields the contract currently declares: drop what it no
 * longer has, prefill what the author gave a default and nobody has touched.
 *
 * ── A PREFILLED FORM IS THE WHOLE POINT OF DECLARING A DEFAULT ─────────────────────────────────
 *
 * Both forms in this console opened BLANK and put the declared default in the `placeholder`. Ghost
 * text looks like a value and is not one, and it vanishes the moment anybody types — so the first
 * thing a new reader does, press Run, posted an empty object and depended on the workflow or the
 * Method repeating each default in its own `req.get(k) or 5`. The number was in two places and on
 * screen in neither.
 *
 * ── WHAT IT WILL NOT OVERWRITE ─────────────────────────────────────────────────────────────────
 *
 * A key that is PRESENT is left alone, and that is what makes this safe to run on every contract
 * re-read — which is every save under `serve --watch`. A box somebody deliberately emptied holds
 * `''`, which is present, so it stays empty instead of refilling itself under the cursor.
 *
 * A field whose author declared NO default is left absent rather than seeded with `''`. The two
 * are different states in {@link FieldValue}: a file control seeded with `''` draws a "clear"
 * button over an empty drop zone, and `payloadOf` would then have to tell "never filled in" from
 * "filled in with nothing".
 *
 * MUTATES `values` IN PLACE, because both callers hold it in a Svelte `$state` proxy and a fresh
 * object would replace the very identity the inputs are bound through.
 */
export function syncDefaults(
  leaves: readonly { name: string; default?: string }[],
  values: Record<string, FieldValue>
): void {
  const declared = new Set(leaves.map((n) => n.name));
  for (const k of Object.keys(values)) if (!declared.has(k)) delete values[k];
  for (const n of leaves) {
    if (n.name in values || n.default === undefined) continue;
    values[n.name] = n.default;
  }
}
