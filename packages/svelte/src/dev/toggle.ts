/**
 * A boolean with three states, and the cycle written as a cycle.
 *
 * `not set` IS NOT `false`. Leaving an optional boolean alone omits the key, so the AUTHOR's default
 * applies — a different outcome from sending `false`, and the one a checkbox cannot express.
 *
 * ── WHY THIS IS A FUNCTION AND NOT A TERNARY ────────────────────────────────────────────────────
 *
 * The React console wrote this as nested ternaries and the `false` arm became unreachable: a
 * `unset = !on && !off` guard swallowed it, so `True` rendered as `not set` and no click could
 * produce `false`. Written as the three transitions it is, that state cannot be skipped — and the
 * table below is checkable by reading it.
 *
 *     true   -> false
 *     false  -> required ? true : unset     (a required field has no unset to return to)
 *     unset  -> true
 */
export type Tri = true | false | undefined;

export function cycle(value: Tri, required: boolean): Tri {
  if (value === true) return false;
  if (value === false) return required ? true : undefined;
  return true;
}

/** What the control says it is. `not set` is spelled out; a blank would read as a rendering bug. */
export function label(value: Tri): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'not set';
}
