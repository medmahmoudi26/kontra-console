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
export interface BlobRef {
  name: string;
  sha256: string;
  size: number;
  path?: string;
}

export type FieldValue = string | boolean | BlobRef | { files: BlobRef[] } | undefined;

export function payloadOf(values: Record<string, FieldValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

/** Which required fields are still absent. Named, because "invalid" is not an actionable message. */
export function missing(required: readonly string[], payload: Record<string, unknown>): string[] {
  return required.filter((k) => payload[k] === undefined);
}
