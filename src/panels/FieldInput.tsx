/**
 * One declared field, collected by whichever control its schema earned.
 *
 * BOTH SURFACES COLLECT THROUGH THIS ONE COMPONENT, for the reason `formFields.ts` gives about the
 * coercion it pairs with: the Actors page builds a Batch (a row per Unit) and the Workflows page
 * builds one argument, and the CONTAINER differs while the cell does not. A `<select>` written twice
 * is a `<select>` that grows a third state on one page only. That is also why the four controls
 * below cost their callers nothing: none of the three call sites passes a `control`, because the
 * schema already said.
 *
 * ── THE FOUR, AND WHAT EACH ONE PREVENTS ────────────────────────────────────────────────────────
 *
 * A CLOSED SET IS A LIST, NOT A HINT. `status: "open" | "closed"` typed into a free-text box fails
 * at the far end of a `kontra workflow serve` minutes later, in a tmux pane — the exact failure
 * `coerceValues` exists to pull forward. Offering the members is the same fix one step earlier: the
 * value cannot be wrong because the wrong values were never on the screen.
 *
 * A BOOLEAN IS A TOGGLE FOR THE SAME REASON, one step further. `coerceField` accepts `true` and
 * `false` and refuses everything else — so `True` (the Python author's own spelling), `yes`, `1` and
 * an empty box were four ways to be told no by a form that could simply not have asked. Two states
 * are the whole domain; a control with two states cannot hold a third.
 *
 * A FILE IS NOT TYPED AT ALL. `kontra.File` derives an object with `name`, `sha256` and `size`, and
 * a form that walked those properties would draw three boxes and ask an operator to type a SHA-256
 * by hand. `FileDrop` uploads the bytes and writes the ref — the same JSON string a box held, typed
 * by dragging instead.
 *
 * NO DOM AT MODULE LOAD — types and markup only, nothing that reaches xterm or CodeMirror, so the
 * render suites in node can draw every state of it.
 */

import { FileDrop } from './FileDrop';
import type { SchemaField } from './MethodContract';
import type { UploadedBlob } from '../run/api';

export function FieldInput({
  field,
  value,
  onChange,
  testId,
  className = 'w-full rounded border border-border bg-background px-1.5 py-1 font-mono text-[11.5px]',
  upload,
}: {
  field: SchemaField;
  value: string;
  onChange(next: string): void;
  testId: string;
  className?: string;
  /** Threaded only by tests — `FileDrop` defaults to the real uploader. */
  upload?: (file: File, relativePath?: string) => Promise<UploadedBlob>;
}): JSX.Element {
  if (field.control === 'file' || field.control === 'folder') {
    return (
      <FileDrop
        kind={field.control}
        value={value}
        onChange={onChange}
        testId={testId}
        upload={upload}
      />
    );
  }

  if (field.control === 'toggle') return <Toggle field={field} value={value} onChange={onChange} testId={testId} />;

  if (!field.enum) {
    return (
      <input
        className={className}
        data-testid={testId}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // A NULLABLE ENUM KEEPS ITS `null`. The text box had one way to say "explicitly nothing" that was
  // not "leave the key out" (ADR-less but load-bearing — see `coerceField`), and a list that dropped
  // it would take a value away from the operator rather than making one easier to reach.
  const nullable = field.type.split('|').some((m) => m.trim() === 'null');
  // A VALUE THAT IS NOT A MEMBER STAYS ON THE SCREEN. A draft carried over from an older version of
  // this Actor can hold one, and a `<select>` that simply did not list it would silently re-answer
  // the question as its first option — a changed Batch nobody edited. Listing it keeps the refusal
  // where the operator can read it, in `coerceValues`.
  const stray = value !== '' && value !== 'null' && !field.enum.includes(value);

  return (
    <select
      className={className}
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {/* Blank is the ABSENT KEY, which is what a required field being blank refuses on. The two
          labels are different facts: one is a choice not yet made, the other is a key left out. */}
      <option value="">{field.required ? 'choose…' : '— not set —'}</option>
      {field.enum.map((member) => (
        <option key={member} value={member}>
          {member}
        </option>
      ))}
      {nullable && <option value="null">null</option>}
      {stray && (
        <option value={value}>{value} — not a declared choice</option>
      )}
    </select>
  );
}

/**
 * A boolean, as two states and a word.
 *
 * IT IS A THREE-STATE CONTROL AND IT HAS TO BE. A form field has always had a value the schema does
 * not: BLANK, which means the key is left out — and for an OPTIONAL boolean that is a real, distinct
 * answer from `false`. A checkbox cannot say it. So the switch draws `true`/`false` and an optional
 * one keeps a way back to unset; a REQUIRED one does not, because leaving a required key out is
 * refused by `coerceValues` anyway and offering the operator a state the form will reject is worse
 * than not offering it.
 *
 * THE WORD IS BESIDE THE SWITCH BECAUSE THE VALUE IS LITERAL. What goes on the wire is `true` or
 * `false`, and an operator reading a Batch of forty rows back is matching what they see here against
 * what the actor logged. A switch with no label makes them infer it from which side the knob is on.
 *
 * THE UNSET STATE IS VISIBLY NEITHER — no fill, knob centred — rather than looking like `false`.
 * Those two are the pair most worth telling apart: one says "the author's default applies", the
 * other says "I have decided: no".
 */
function Toggle({
  field,
  value,
  onChange,
  testId,
}: {
  field: SchemaField;
  value: string;
  onChange(next: string): void;
  testId: string;
}): JSX.Element {
  const on = value === 'true';
  const off = value === 'false';
  // BLANK IS UNSET; ANYTHING ELSE UNRECOGNISED IS A STRAY. These were one condition — `!on && !off`
  // — which made every stray value render as `not set`, hiding a value `coerceField` is about to
  // refuse behind the label for a value it accepts. `True` (the Python author's own spelling) is
  // exactly the case, and it made the stray branch below unreachable.
  const unset = value === '';
  const stray = !unset && !on && !off;

  /**
   * The next value one click asks for.
   *
   * WRITTEN AS THE CYCLE ITSELF rather than as nested ternaries, which is how it was and how it got
   * `true → ''` instead of `true → false`: an optional field skipped `false` entirely, so the one
   * state an operator most often wants was unreachable by clicking.
   *
   *   optional   unset → true → false → unset      every state the field can hold
   *   required   unset → true → false → true       no unset, because `coerceValues` refuses it
   *
   * A stray value resolves to `true` — one click to something that works.
   */
  const next = (): string => {
    if (on) return 'false';
    if (off) return field.required ? 'true' : '';
    return 'true';
  };

  return (
    <span className="flex items-center gap-2" data-testid={`${testId}-toggle`}>
      <button
        type="button"
        role="switch"
        aria-checked={unset ? 'mixed' : on}
        aria-label={field.name}
        data-testid={testId}
        data-value={value}
        onClick={() => onChange(next())}
        className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors ${
          on
            ? 'border-primary bg-primary'
            : off
            ? 'border-border bg-muted'
            : 'border-dashed border-border bg-transparent'
        }`}
      >
        <span
          className={`absolute top-0.5 size-2.5 rounded-full transition-all ${
            on
              ? 'left-3.5 bg-primary-foreground'
              : off
              ? 'left-0.5 bg-muted-foreground'
              : 'left-2 bg-muted-foreground/50'
          }`}
        />
      </button>
      <span className="font-mono text-[10.5px] text-muted-foreground">
        {unset ? (
          // NOT "false". An optional boolean nobody has touched leaves the key out, and the author's
          // own default is what the actor will then see — which is a different outcome from `false`
          // and is the one an operator is most likely to assume wrongly.
          <span title="the key is left out, so the author’s default applies">not set</span>
        ) : stray ? (
          <span className="text-destructive" title="not true or false — this row will be refused">
            {value}
          </span>
        ) : (
          String(on)
        )}
      </span>
    </span>
  );
}
