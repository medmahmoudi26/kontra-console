/**
 * One registry entry, at three densities.
 *
 * THE DENSITY IS THE OPERATOR'S, NOT THE DESIGNER'S, and that is the whole reason there are three.
 * A registry with six entries wants descriptions on screen; a registry with sixty wants names. The
 * same list serves both, so the choice belongs to whoever is looking — and it persists, because an
 * operator who prefers rows prefers them tomorrow as well.
 *
 *   roomy    the author's sentence, the Methods, the facts. What you read when you are deciding.
 *   compact  name, kind, state, facts. What you scan when you know roughly what you want.
 *   list     one row. What you use when you are looking for a name you already know.
 *
 * WHAT NEVER DROPS, AT ANY DENSITY: the kind, the name, the state and whether the code is on this
 * disk. Those four are what an entry IS — a list row that hid the state would make the densest view
 * the one that says least about what is happening, which is backwards.
 *
 * THE WHOLE CARD IS THE BUTTON. An entry has exactly one verb here — open it where it lives — and a
 * card with one action should not put that action in a corner of itself. It also means the Methods
 * inside cannot be links: a button inside a button is invalid HTML and the browser resolves it by
 * dropping one of them, so the Methods are TEXT that describes the destination rather than more
 * destinations. Reaching one Method is what the Actors surface is for.
 *
 * EXCEPT WHERE THERE IS NOWHERE TO GO, and then it is not a button at all. Both work surfaces are
 * built on `NO FOLDER, NO ACTOR` — they list one row per registered folder, because their verbs all
 * need a directory on this disk — so an entry marked `not on this disk` has no row on either of
 * them. Navigating would land the operator on a page that says "no Actor matches this filter",
 * which is a dead end dressed as a destination. `SideNav`'s pulse already settled this for the same
 * reason and in the same words: a control that navigates nowhere is worse than a line of text that
 * never claimed it would. So the card renders as a `div`, keeps every fact it had — the Methods,
 * the version, the state — and the badge says why there is no way in.
 */

import { Boxes, Workflow } from 'lucide-react';

import { StatePill } from './StatePill';
import type { CatalogEntry } from '@kontra/console-core/panels/catalog';

export type CardLayout = 'roomy' | 'compact' | 'list';

/** What each state claims, in words. The pill's colour cannot carry this and must not try to. */
const STATE_TITLE: Record<CatalogEntry['state'], string> = {
  running: 'an execution of this was open when this page loaded',
  // READ ONCE, ON ARRIVAL. This surface does not poll — see `CatalogPage.tsx` — so every state
  // below is as at load, and the words say so rather than implying a live reading. Open the entry,
  // or press Refresh, for a current one.
  serving: 'a worker was polling its queue when this page loaded, with nothing to do — it is ready',
  idle: 'nothing was polling its queue when this page loaded. Serve it before starting anything, or the work sits on a queue nobody reads.',
  unserved:
    'no worker has ever registered this. It is a folder on this disk and nothing more yet — serve it to find out what it declares.',
  unknown:
    'Temporal could not be asked whether anything is serving this. NOT the same as idle — the answer is missing, not negative.',
};

const KIND_TITLE: Record<CatalogEntry['kind'], string> = {
  workflow: 'a caller workflow — the thing you run. Opens its thread.',
  actor: 'a deployed worker — the thing a workflow calls a Method on. Opens it on the Actors surface.',
};

/**
 * Where the code is, in two words, or nothing.
 *
 * SILENT WHEN IT IS HERE, and loud when it is not. Most of a working installation is on this disk,
 * so a badge on every card would be noise that stops being read — and the case worth pointing at is
 * the other one: an entry you cannot open, edit, serve or forget, because its code is on a Machine
 * somewhere. That is not a fault, and the badge does not read as one; it is the answer to "why is
 * there no edit button on this".
 */
function placeNote(entry: CatalogEntry): string | null {
  return entry.place === 'elsewhere' ? 'not on this disk' : null;
}

export interface CatalogCardProps {
  entry: CatalogEntry;
  layout: CardLayout;
  onOpen(entry: CatalogEntry): void;
}

export function CatalogCard({ entry, layout, onOpen }: CatalogCardProps): JSX.Element {
  const Icon = entry.kind === 'workflow' ? Workflow : Boxes;
  const place = placeNote(entry);
  const stateTitle = STATE_TITLE[entry.state];
  /** See the header: an entry with no folder here has no row on either work surface. */
  const reachable = entry.place === 'disk';

  const shared = {
    'data-testid': `catalog-entry-${entry.id}`,
    'data-kind': entry.kind,
    'data-state': entry.state,
    'data-place': entry.place,
    'data-reachable': reachable ? 'true' : undefined,
  };
  /** A `button` where there is somewhere to go, a `div` where there is not — same markup either
   *  way, so nothing about the entry is hidden by being unreachable. */
  const Box = reachable ? 'button' : 'div';
  const action = reachable
    ? { type: 'button' as const, onClick: () => onOpen(entry) }
    : {
        title:
          'no folder on this machine holds this code, so there is nothing here to open, edit, serve or forget. Register the folder it came from and it becomes reachable.',
      };

  if (layout === 'list') {
    return (
      <Box
        {...shared}
        {...action}
        className={`flex w-full items-center gap-3 border-b border-border px-4 py-2 text-left ${
          reachable ? 'hover:bg-accent/50' : 'opacity-80'
        }`}
      >
        <Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-mono text-[12px] font-semibold">{entry.name}</span>
        {entry.version !== '' && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {entry.version}
          </span>
        )}
        {/* The sentence still appears where there is room for it — it is the one thing a name
            cannot say, and hiding it at every density would make this view a list of strings. */}
        <span className="hidden min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground sm:inline">
          {entry.description}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {place !== null && <PlaceBadge note={place} />}
          <StatePill state={entry.state} testid={`catalog-state-${entry.id}`} title={stateTitle} small />
        </span>
      </Box>
    );
  }

  const roomy = layout === 'roomy';
  return (
    <Box
      {...shared}
      {...action}
      className={`flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left ${
        reachable ? 'hover:border-muted-foreground/40 hover:bg-accent/30' : 'border-dashed'
      }`}
    >
      <span className="flex items-center gap-2">
        {/* The tooltip is on a wrapper, not on the glyph: lucide's props do not include `title`,
            and an SVG that swallowed it would leave the one explanation of what a kind IS
            unreachable. */}
        <span className="flex shrink-0 items-center" title={KIND_TITLE[entry.kind]}>
          <Icon size={13} className="text-muted-foreground" aria-hidden />
        </span>
        <span className="truncate font-mono text-[12.5px] font-semibold">{entry.name}</span>
        {entry.version !== '' && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {entry.version}
          </span>
        )}
        <span className="ml-auto shrink-0">
          <StatePill state={entry.state} testid={`catalog-state-${entry.id}`} title={stateTitle} small />
        </span>
      </span>

      {roomy && (
        <span className="line-clamp-2 min-h-[2.4em] text-[11.5px] leading-snug text-muted-foreground">
          {/* UNDESCRIBED SAYS SO. An empty line would read as a description that failed to load,
              and the fix — writing a `description.md`, or a docstring — is something the reader can
              actually do. */}
          {entry.description === '' ? (
            <em className="not-italic opacity-60">no description</em>
          ) : (
            entry.description
          )}
        </span>
      )}

      {roomy && entry.kind === 'actor' && <Methods entry={entry} />}

      <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        {entry.facts.map((fact) => (
          <span key={fact.label} title={fact.title} data-testid={`catalog-fact-${entry.id}-${fact.label}`}>
            <span className="tabular-nums text-foreground">{fact.value}</span> {fact.label}
          </span>
        ))}
        {place !== null && (
          <span className="ml-auto">
            <PlaceBadge note={place} />
          </span>
        )}
      </span>
    </Box>
  );
}

/**
 * The Methods an Actor declares — the line an operator actually scans for.
 *
 * NONE AND UNKNOWN ARE DIFFERENT SENTENCES. An Actor nothing has served has no descriptor, so its
 * Methods are not known; an Actor that registered with no operations declared none. Printing
 * "no methods" for the first would be stating something nobody has established.
 */
function Methods({ entry }: { entry: CatalogEntry }): JSX.Element {
  if (entry.state === 'unserved') {
    return (
      <span className="font-mono text-[10px] text-muted-foreground" data-testid={`catalog-methods-${entry.id}`}>
        methods unknown — nothing has served this yet
      </span>
    );
  }
  if (entry.methods.length === 0) {
    return (
      <span className="font-mono text-[10px] text-muted-foreground" data-testid={`catalog-methods-${entry.id}`}>
        declares no Methods
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1" data-testid={`catalog-methods-${entry.id}`}>
      {entry.methods.slice(0, 6).map((m) => (
        <span key={m} className="rounded border border-border px-1.5 py-px font-mono text-[9.5px]">
          {m}
        </span>
      ))}
      {entry.methods.length > 6 && (
        <span className="px-1 font-mono text-[9.5px] text-muted-foreground">
          +{entry.methods.length - 6}
        </span>
      )}
    </span>
  );
}

function PlaceBadge({ note }: { note: string }): JSX.Element {
  return (
    <span
      className="whitespace-nowrap rounded border border-dashed border-border px-1.5 py-px font-mono text-[9.5px] text-muted-foreground"
      title="this was registered by a worker running code that is not in any folder on this machine. It can be found and read, but not edited, served or forgotten from here."
    >
      {note}
    </span>
  );
}
