/**
 * THE HOST BRIDGE — the two things an embedding editor can tell this frame that it cannot find out
 * for itself: what is on the clipboard, and that the file on screen was just saved.
 *
 * ── WHY THIS HAS TO EXIST ───────────────────────────────────────────────────────────────────────
 *
 * The `/dev` pane is embedded as an `<iframe>` inside a `vscode-webview://` document. Two things
 * follow from that nesting, and neither is ours to configure:
 *
 *   • ⌘V / Ctrl+V is consumed by the editor's keybinding layer before the inner document sees a
 *     `keydown`, so no `paste` event is ever fired here.
 *   • the context menu in a webview is the EDITOR's menu, not the browser's, so its Paste item —
 *     when there is one — acts on the editor, not on this frame.
 *
 * MEASURED in Cursor: neither the keystroke nor right-click Paste put a single character into a
 * field on this page. A form you cannot paste into is not a small problem when the value is a
 * generated credential or an id somebody copied from a log.
 *
 * ── THE ARRANGEMENT ─────────────────────────────────────────────────────────────────────────────
 *
 * The extension binds the keystroke (it CAN see it), reads the real clipboard through
 * `vscode.env.clipboard`, and posts the text down. This side writes it into whatever is focused.
 * The clipboard is never read from here — this page has no permission to and does not need one.
 *
 * ── WHY `event.source === window.parent` IS THE WHOLE CHECK ──────────────────────────────────────
 *
 * The framing document is the only window that may drive this, and it is the only one that can
 * satisfy that identity. An origin allow-list would be the usual instinct and is the wrong tool
 * here: a webview's origin is `vscode-webview://<a uuid that changes every session>`, so there is
 * no stable string to compare against, and pinning `'*'` would accept any frame that got a handle
 * to this window. Identity is the stronger claim and the stable one.
 *
 * It only ever writes into a focused `<input>` or `<textarea>`, so the worst a hostile parent could
 * do is type into a form the user is already looking at — which a parent that can frame you can do
 * by other means anyway.
 */

/* ── RELOAD ──────────────────────────────────────────────────────────────────────────────────────
 *
 * The pane draws its form from the code ON DISK (`/api/sources/actor/:id/schema`), so a saved edit
 * changes the form — but only if something re-reads it. Polling would work and is the wrong shape
 * for an editor: the host already knows the exact moment, because the save went through it. So the
 * extension sends this on `onDidSaveTextDocument` and the pane re-reads once, immediately.
 */

/** The messages the host sends. Kept narrow so nothing else on this channel is ever acted on. */
interface HostPaste {
  type: 'kontra.paste';
  text: string;
}

function isHostPaste(data: unknown): data is HostPaste {
  const m = data as Partial<HostPaste> | null;
  return typeof m?.text === 'string' && m.type === 'kontra.paste';
}

function isHostReload(data: unknown): boolean {
  return (data as { type?: unknown } | null)?.type === 'kontra.reload';
}

/**
 * Replace the selection in a React-controlled field.
 *
 * ASSIGNING `el.value` IS NOT ENOUGH and the failure is silent. React tracks the last value it
 * rendered on the DOM node; a direct assignment updates the node, React's `onChange` never fires,
 * and the next render puts the old value straight back — so the text appears and then vanishes.
 * Going through the PROTOTYPE's setter and dispatching a bubbling `input` event is what React's
 * synthetic event system actually listens for.
 */
function insert(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);

  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  if (setter) setter.call(el, next);
  else el.value = next;

  const caret = start + text.length;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Listen for the host's paste. Returns the unsubscribe, so a caller can stop listening. */
export function listenForHostPaste(target: Window = window): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== target.parent) return;
    if (!isHostPaste(event.data)) return;
    const el = target.document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (!el.readOnly && !el.disabled) insert(el, event.data.text);
    }
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}

/**
 * Listen for the host's "the file was saved" signal. Returns the unsubscribe.
 *
 * Same `event.source` identity check as the paste above, and for the same reason — this one only
 * triggers a re-read of a route the page may already call, so the worst a hostile parent achieves
 * is a redundant GET. It is checked anyway: a listener that is loose because its payload looks
 * harmless is the one that becomes a problem when somebody gives it a payload later.
 */
/**
 * Answer the host's request for the current selection — the copy half of the host path.
 *
 * The host cannot read this frame's selection (cross-origin), and this frame may not be allowed to
 * write the clipboard. So the host asks, this replies, and the host writes it with the editor's own
 * API, which needs no permission. Returns the unsubscribe.
 */
export function listenForHostCopy(target: Window = window): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== target.parent) return;
    if ((event.data as { type?: unknown } | null)?.type !== 'kontra.copy') return;
    const text = selectedText(target.document);
    if (text) target.parent.postMessage({ type: 'kontra.copied', text }, '*');
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}

export function listenForHostReload(fn: () => void, target: Window = window): () => void {
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== target.parent) return;
    if (isHostReload(event.data)) fn();
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}

/**
 * Tell the framing host this frame is LISTENING — not merely loaded.
 *
 * The host's only cross-origin readiness signal is the iframe's `load`, which reports that a
 * DOCUMENT arrived. It says nothing about whether React has committed, and the listener is attached
 * in an effect that runs after commit. Worse, `LoginGate` wraps this pane: while it draws a
 * password form the pane does not mount at all, so the listener never exists and every reload the
 * host posts is dropped silently, forever. A queue keyed on `load` cannot see any of that.
 *
 * So readiness is ANNOUNCED by the side that knows it. Called after the listener is attached, which
 * is the entire point of where it sits.
 *
 * `'*'` as the target origin because a webview's is `vscode-webview://<a uuid that changes every
 * session>` — there is no stable string to name, and the payload carries nothing, so there is
 * nothing to leak by being broad.
 */
export function announceReady(target: Window = window): void {
  if (target.parent !== target) target.parent.postMessage({ type: 'kontra.ready' }, '*');
}

/** The text currently selected, from an input/textarea caret or an ordinary document selection. */
function selectedText(doc: Document): string {
  const el = doc.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (end > start) return el.value.slice(start, end);
  }
  return String(doc.defaultView?.getSelection() ?? '');
}

/**
 * ⌘C / ⌘V handled HERE, when the keystroke reaches this document at all.
 *
 * ── WHY BOTH THIS AND THE HOST PATH ─────────────────────────────────────────────────────────────
 *
 * This frame is nested cross-origin inside an editor webview, and there are two possible worlds:
 * either the editor's keybinding layer takes ⌘V before this document sees it (then the extension's
 * `kontra.paste` command fires and posts the text in), or the keystroke arrives here and the editor
 * never knows (then nothing in the extension can help). MEASURED in Cursor: neither the keystroke
 * nor right-click Paste moved a character, which rules out the ordinary browser path but not which
 * of the two worlds we are in. So both are covered, and whichever gets the key wins.
 *
 * ── AND WHY IT CANNOT SIMPLY ALWAYS RUN ─────────────────────────────────────────────────────────
 *
 * If the ordinary browser path DOES work somewhere — a real browser tab, which is a supported way
 * to open `/dev` — then acting on the keydown too would insert the clipboard twice. So a native
 * `paste`/`copy` event is treated as proof the platform is handling it, latched permanently, and
 * this fallback stands down. The deferral to a macrotask is what lets that event arrive first.
 *
 * `navigator.clipboard` is reachable because `http://127.0.0.1` is a secure context and the host
 * frames us with `allow="clipboard-read; clipboard-write"`. Where it is refused, this does nothing
 * and the host path remains.
 */
export function installLocalClipboard(target: Window = window): () => void {
  const doc = target.document;
  let nativePaste = false;
  let nativeCopy = false;

  const onPaste = (): void => {
    nativePaste = true;
  };
  const onCopy = (): void => {
    nativeCopy = true;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== 'v' && key !== 'c') return;
    if (key === 'v' ? nativePaste : nativeCopy) return;

    target.setTimeout(() => {
      if (key === 'v' ? nativePaste : nativeCopy) return;
      if (key === 'v') {
        const el = doc.activeElement;
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
        if (el.readOnly || el.disabled) return;
        void navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text) insert(el, text);
          })
          .catch(() => {
            /* refused — the host path is the other half, and it needs no permission */
          });
        return;
      }
      const text = selectedText(doc);
      if (text) void navigator.clipboard?.writeText(text).catch(() => {});
    }, 0);
  };

  doc.addEventListener('paste', onPaste, true);
  doc.addEventListener('copy', onCopy, true);
  doc.addEventListener('keydown', onKeyDown, true);
  return () => {
    doc.removeEventListener('paste', onPaste, true);
    doc.removeEventListener('copy', onCopy, true);
    doc.removeEventListener('keydown', onKeyDown, true);
  };
}

export const __test = { isHostPaste, isHostReload, insert, selectedText };
