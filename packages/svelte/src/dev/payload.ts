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
