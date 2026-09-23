/**
 * What `/api/workspaces` answers, made safe to render.
 *
 * ── A CONSOLE MUST NOT DIE ON A SHAPE IT DID NOT EXPECT ─────────────────────────────────────────
 *
 * The picker read `body.names.length` straight off the response and threw
 * `Cannot read properties of undefined` — forty times, in the browser suite, because that fixture
 * answers `{}` for routes it does not model. The same throw is what an OLDER control plane would
 * produce on a newer console, and it takes the whole page with it: this component is in the shell,
 * so the crash is not "the picker is missing", it is a blank console.
 *
 * Every field is checked and defaulted. An answer that carries nothing becomes "no workspace",
 * which is a state the header already knows how to say.
 */
export interface Workspaces {
  parent: string;
  current: string;
  names: string[];
  currentPath: string;
  mountHint: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function readWorkspaces(body: unknown): Workspaces {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    parent: str(b.parent),
    current: str(b.current),
    // FILTERED, not just defaulted: a list with a number in it would render a blank option that
    // switches the workspace to nothing when picked.
    names: Array.isArray(b.names) ? b.names.filter((n): n is string => typeof n === 'string') : [],
    currentPath: str(b.currentPath),
    mountHint: str(b.mountHint),
  };
}
