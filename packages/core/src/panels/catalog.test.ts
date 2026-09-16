/**
 * The registry, attacked where it would be flattering rather than true.
 *
 * The claims worth pinning are the ones that make this surface different from the two it sits
 * beside: that it shows deployments whose code is NOT on this disk, that a Method's own sentence is
 * searchable, that `unknown` never renders as `idle`, and that a folder and the descriptor a worker
 * registered from it are ONE entry rather than two.
 */

import { describe, expect, it } from 'vitest';
import { sharedQueue } from '@kontra/core/queues';

import {
  NO_FILTER,
  buildCatalog,
  isFiltered,
  matchEntry,
  queuesOf,
  resultLabel,
  type CatalogEntry,
  type CatalogInput,
} from './catalog';
import type { Source, WorkflowDescriptor, RunRow } from '../run/api';
import type { PollerReport } from '../run/workflowState';
import type { CatalogActor } from '../types';

const NOW = 1_700_000_000_000;

function folder(over: Partial<Source> & Pick<Source, 'name'>): Source {
  return {
    id: `src:${over.name}`,
    kind: 'actor',
    path: `/srv/${over.name}`,
    version: '',
    description: '',
    registeredAt: 1,
    ...over,
  };
}

function actor(over: Partial<CatalogActor> & Pick<CatalogActor, 'name' | 'version'>): CatalogActor {
  return {
    key: `${over.name}@${over.version}`,
    schemaVersion: 'kontra.actor.v1',
    operations: [],
    ...over,
  };
}

/** A queue with a live poller. `lastPoll` is NOW, because a stale one is a different test. */
function serving(queue: string): PollerReport {
  return { queue, pollers: 1, identities: ['w1'], workers: [], lastPoll: NOW };
}

function quiet(queue: string): PollerReport {
  return { queue, pollers: 0, identities: [], workers: [], lastPoll: 0 };
}

function input(over: Partial<CatalogInput> = {}): CatalogInput {
  return {
    workflowFolders: [],
    workflowFiles: [],
    descriptors: [],
    runs: [],
    actorFolders: [],
    actors: [],
    pollers: {},
    now: NOW,
    ...over,
  };
}

function byName(entries: CatalogEntry[], name: string): CatalogEntry {
  const hit = entries.filter((e) => e.name === name);
  expect(hit, `no entry named ${name} — got ${entries.map((e) => e.name).join(', ')}`).toHaveLength(
    1
  );
  return hit[0]!;
}

describe('the registry holds what the work surfaces refuse to draw', () => {
  it('lists an Actor whose code is on nobody’s disk here', () => {
    // THE WHOLE REASON THIS SURFACE EXISTS. `ActorsPage` draws one card per registered folder and
    // deliberately hides catalog rows with no folder; an operator looking for the worker that is
    // extracting titles on a droplet would find nothing anywhere in the console.
    const entries = buildCatalog(
      input({ actors: [actor({ name: 'extract', version: '0.2.0', source: '/opt/kontra/actor/extract' })] })
    );
    const hit = byName(entries, 'extract');
    expect(hit.place).toBe('elsewhere');
    expect(hit.path).toBe('');
  });

  it('marks the same Actor as on-disk once a folder points at it', () => {
    // Non-vacuous partner to the case above: if `place` were hard-coded, both would pass alone.
    const entries = buildCatalog(
      input({
        actors: [actor({ name: 'extract', version: '0.2.0', source: '/srv/extract' })],
        actorFolders: [folder({ name: 'extract', version: '0.2.0' })],
      })
    );
    expect(byName(entries, 'extract').place).toBe('disk');
    expect(byName(entries, 'extract').path).toBe('/srv/extract');
  });

  it('does not count a registration whose directory is gone as on-disk', () => {
    // `absent` is a registration whose folder went with a `git checkout`. The row survives — it is
    // the operator's to keep or forget — but nothing on this disk can be opened.
    const entries = buildCatalog(
      input({
        actors: [actor({ name: 'extract', version: '0.2.0' })],
        actorFolders: [folder({ name: 'extract', version: '0.2.0', absent: true })],
      })
    );
    expect(byName(entries, 'extract').place).toBe('elsewhere');
    expect(byName(entries, 'extract').path).toBe('');
  });

  it('lists a folder nothing has ever served, with its Methods UNKNOWN rather than none', () => {
    const entries = buildCatalog(input({ actorFolders: [folder({ name: 'probe', version: '0.1.0' })] }));
    const hit = byName(entries, 'probe');
    expect(hit.state).toBe('unserved');
    // No registration means no descriptor, so no Method list — and no queue to ask about either.
    expect(hit.methods).toEqual([]);
    expect(hit.queue).toBe('');
  });
});

describe('a Method’s own sentence is searchable', () => {
  const entries = buildCatalog(
    input({
      actors: [
        actor({
          name: 'crawler',
          version: '1.0.0',
          operations: [
            { name: 'fetch', description: 'fetch one page of results and emit its body' },
            { name: 'title', description: 'pull the <title> out of a page' },
          ],
        }),
      ],
    })
  );

  it('found the actor at all', () => {
    // The guard on the guard: every assertion below would pass vacuously against an empty list.
    expect(entries).toHaveLength(1);
  });

  it('matches words from the author’s description, not just the name', () => {
    // NOTHING ELSE IN THE CONSOLE ANSWERS THIS. The Actors grid filters on names and the catalog
    // API has no search at all.
    expect(matchEntry(entries[0]!, { ...NO_FILTER, q: 'emit its body' })).toBe(true);
    expect(matchEntry(entries[0]!, { ...NO_FILTER, q: 'title' })).toBe(true);
  });

  it('matches every word in any order, because that is how anybody narrows a list', () => {
    expect(matchEntry(entries[0]!, { ...NO_FILTER, q: 'page fetch' })).toBe(true);
    // A single `includes` of the whole string would fail this, which is the bug this rule prevents.
    expect(entries[0]!.haystack.includes('page fetch')).toBe(false);
  });

  it('refuses a word that is nowhere in the entry', () => {
    expect(matchEntry(entries[0]!, { ...NO_FILTER, q: 'page smuggling' })).toBe(false);
  });

  it('does not summarise a multi-Method Actor by one of its Methods', () => {
    // "fetch one page" printed under an Actor that also extracts titles is a summary that misleads.
    expect(entries[0]!.description).toBe('');
  });

  it('does borrow the sentence when there is only one Method to borrow', () => {
    const one = buildCatalog(
      input({
        actors: [
          actor({
            name: 'beacon',
            version: '0.1.0',
            operations: [{ name: 'run', description: 'ping a host and report the latency' }],
          }),
        ],
      })
    );
    expect(byName(one, 'beacon').description).toBe('ping a host and report the latency');
  });
});

describe('unknown is never drawn as idle', () => {
  // DERIVED, NOT SPELLED. This literal was `kontra-probe-0.1.0` — a guess — and every case below
  // passed as `unknown` because the report was filed under a queue no entry was asking about. A
  // hard-coded queue name in a test is the same class of bug as one in production code, so the
  // derivation is the authority here too and the literal is checked exactly once.
  const queue = sharedQueue('probe', '0.1.0');

  it('is the queue the rest of the app derives', () => {
    expect(queue).toBe('probe-0.1.0');
  });

  it('a queue nobody has asked about yet is unknown', () => {
    // Every card is in this state until the first poll lands, and "nothing is serving this" is the
    // one thing it must not say.
    const entries = buildCatalog(input({ actors: [actor({ name: 'probe', version: '0.1.0' })] }));
    expect(byName(entries, 'probe').state).toBe('unknown');
  });

  it('a queue that could not be asked is unknown, even though the count is zero', () => {
    const entries = buildCatalog(
      input({
        actors: [actor({ name: 'probe', version: '0.1.0' })],
        pollers: { [queue]: { ...quiet(queue), error: 'temporal unreachable' } },
      })
    );
    expect(byName(entries, 'probe').state).toBe('unknown');
  });

  it('a queue that WAS asked, with nobody polling, is idle', () => {
    const entries = buildCatalog(
      input({
        actors: [actor({ name: 'probe', version: '0.1.0' })],
        pollers: { [queue]: quiet(queue) },
      })
    );
    expect(byName(entries, 'probe').state).toBe('idle');
  });

  it('a queue with a live poller is serving', () => {
    const entries = buildCatalog(
      input({
        actors: [actor({ name: 'probe', version: '0.1.0' })],
        pollers: { [queue]: serving(queue) },
      })
    );
    expect(byName(entries, 'probe').state).toBe('serving');
  });

  it('a poller that last polled hours ago is not serving', () => {
    // `isServing` owns the window; this pins that the catalog defers to it rather than reading the
    // count, which is the difference between "a worker is there" and "a worker was there".
    const entries = buildCatalog(
      input({
        actors: [actor({ name: 'probe', version: '0.1.0' })],
        pollers: { [queue]: { ...serving(queue), lastPoll: NOW - 3_600_000 } },
      })
    );
    expect(byName(entries, 'probe').state).toBe('idle');
  });
});

describe('a workflow and the descriptor registered from it are one entry', () => {
  const descriptor: WorkflowDescriptor = {
    name: 'DnsSweep',
    description: 'sweep a domain for live hosts',
    queue: 'wf-dnssweep-abc123abc123',
    savedAt: 1,
  };

  it('joins a folder to its type across the spelling', () => {
    // `dns_sweep` on disk, `DnsSweep` in the descriptor. Two rows for one workflow is the failure
    // the whole surface is judged on — an operator scanning a registry cannot tell which to open.
    const entries = buildCatalog(
      input({
        workflowFolders: [folder({ name: 'dns_sweep', kind: 'workflow' })],
        descriptors: [descriptor],
      })
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('DnsSweep');
    expect(entries[0]!.place).toBe('disk');
    // The descriptor's sentence wins over a folder's `description.md` — the class docstring is
    // about the workflow, and `description.md` is about the directory.
    expect(entries[0]!.description).toBe('sweep a domain for live hosts');
  });

  it('lists a descriptor with no folder here, and a folder with no descriptor, as themselves', () => {
    const entries = buildCatalog(
      input({
        workflowFolders: [folder({ name: 'canary', kind: 'workflow' })],
        descriptors: [descriptor],
      })
    );
    expect(entries.map((e) => e.name).sort()).toEqual(['DnsSweep', 'canary']);
    expect(byName(entries, 'DnsSweep').place).toBe('elsewhere');
    // Never registered, so there is nothing to ask about — not `unknown`, which would imply a
    // question that failed.
    expect(byName(entries, 'canary').state).toBe('unserved');
  });

  it('is running when a run of its TYPE is open, whatever its queue says', () => {
    const run: RunRow = {
      runId: 'r1',
      type: 'DnsSweep',
      status: 'running',
      tenant: 'default',
      startedAt: 1,
      closedAt: 0,
      dispatches: 2,
    };
    const entries = buildCatalog(
      input({
        descriptors: [descriptor],
        runs: [run],
        // Nothing is polling. A run open on a queue nobody serves is the most important state on
        // the Workflows page, and it must not be hidden behind `idle` here either.
        pollers: { [descriptor.queue!]: quiet(descriptor.queue!) },
      })
    );
    expect(byName(entries, 'DnsSweep').state).toBe('running');
    expect(byName(entries, 'DnsSweep').facts[0]?.label).toBe('run open');
  });

  it('does not count a CLOSED run as an open one', () => {
    const run: RunRow = {
      runId: 'r1',
      type: 'DnsSweep',
      status: 'completed',
      tenant: 'default',
      startedAt: 1,
      closedAt: 2,
      dispatches: 2,
    };
    const entries = buildCatalog(
      input({
        descriptors: [descriptor],
        runs: [run],
        pollers: { [descriptor.queue!]: serving(descriptor.queue!) },
      })
    );
    expect(byName(entries, 'DnsSweep').state).toBe('serving');
  });

  it('reports a descriptor that named no queue as unknown, not as unserved', () => {
    // It registered — a worker served it — so "nothing ever served this" would be false. What is
    // missing is the queue, which is a question that cannot be answered rather than a negative one.
    const entries = buildCatalog(input({ descriptors: [{ name: 'Old', savedAt: 1 }] }));
    expect(byName(entries, 'Old').state).toBe('unknown');
  });

  it('counts the declared input’s fields, and says nothing when none was declared', () => {
    const entries = buildCatalog(
      input({
        descriptors: [
          { ...descriptor, input: { type: 'object', properties: { domain: {}, depth: {} } } },
          { name: 'Bare', savedAt: 1 },
        ],
      })
    );
    expect(byName(entries, 'DnsSweep').facts.map((f) => f.label)).toContain('input fields');
    expect(byName(entries, 'DnsSweep').facts.find((f) => f.label === 'input fields')?.value).toBe('2');
    // A workflow whose author declared nothing prints nothing — not `0 input fields`, which would
    // claim the author declared an empty type.
    expect(byName(entries, 'Bare').facts).toEqual([]);
  });
});

describe('an actor is one entry, not one per version', () => {
  const six = ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0'].map((v) =>
    actor({ name: 'cachebuster', version: v, operations: [{ name: 'run' }] })
  );

  it('collapses them', () => {
    // MEASURED ON A REAL INSTALLATION: 29 catalog rows for 14 actors, `cachebuster` six times. A
    // registry where finding one actor means reading six identical cards is the noise the Actors
    // page already removed, and every version is a distinct queue — so one row per version was also
    // 42 DescribeTaskQueue calls on a browse page.
    const entries = buildCatalog(input({ actors: six }));
    expect(entries).toHaveLength(1);
    expect(byName(entries, 'cachebuster').version).toBe('0.6.0');
  });

  it('says how many there are rather than hiding the others', () => {
    const fact = byName(buildCatalog(input({ actors: six })), 'cachebuster').facts.find(
      (f) => f.label === 'versions'
    );
    expect(fact?.value).toBe('6');
    // And it admits what the collapse costs, because the state shown is one version's.
    expect(fact?.title).toContain('0.1.0, 0.2.0');
    expect(fact?.title).toContain('An older version somebody is still serving is not counted');
  });

  it('says nothing about versions when there is only one', () => {
    const one = buildCatalog(input({ actors: [actor({ name: 'probe', version: '0.1.0' })] }));
    expect(byName(one, 'probe').facts.map((f) => f.label)).not.toContain('versions');
  });

  it('orders versions numerically, so 0.10.0 beats 0.9.0', () => {
    // A string compare puts `0.9.0` after `0.10.0`, which would make the card about a version two
    // releases old and — worse — ask about that version's queue.
    const entries = buildCatalog(
      input({
        actors: [
          actor({ name: 'x', version: '0.9.0' }),
          actor({ name: 'x', version: '0.10.0' }),
        ],
      })
    );
    expect(byName(entries, 'x').version).toBe('0.10.0');
  });

  it('picks the version ON THIS DISK over the highest one', () => {
    // A directory holding 0.3.0 with newer deploys behind it is the code the operator can open, so
    // it is the one the card should be about — `catalogForFolder`'s rule, from the other side.
    const entries = buildCatalog(
      input({
        actors: [
          actor({ name: 'y', version: '0.3.0' }),
          actor({ name: 'y', version: '0.9.0' }),
        ],
        actorFolders: [folder({ name: 'y', version: '0.3.0' })],
      })
    );
    expect(byName(entries, 'y').version).toBe('0.3.0');
    expect(byName(entries, 'y').place).toBe('disk');
  });

  it('searches across every version it collapsed', () => {
    // A Method that existed in 0.1.0 and was renamed in 0.2.0 is still how somebody remembers it.
    const entries = buildCatalog(
      input({
        actors: [
          actor({ name: 'z', version: '0.1.0', operations: [{ name: 'scrape' }] }),
          actor({ name: 'z', version: '0.2.0', operations: [{ name: 'harvest' }] }),
        ],
      })
    );
    const z = byName(entries, 'z');
    expect(z.methods).toEqual(['harvest']); // the card is about 0.2.0
    expect(matchEntry(z, { ...NO_FILTER, q: 'scrape' })).toBe(true);
    expect(matchEntry(z, { ...NO_FILTER, q: '0.1.0' })).toBe(true);
  });

  it('asks about one queue per actor, not one per version', () => {
    // The measurement that forced the collapse: every version is a distinct shared queue.
    expect(queuesOf(buildCatalog(input({ actors: six })))).toEqual(['cachebuster-0.6.0']);
  });
});

describe('what the page has to ask the cluster about', () => {
  it('is every registered queue, deduplicated and sorted', () => {
    const entries = buildCatalog(
      input({
        descriptors: [{ name: 'B', savedAt: 1, queue: 'wf-b' }, { name: 'A', savedAt: 1, queue: 'wf-a' }],
        actors: [actor({ name: 'probe', version: '0.1.0' })],
      })
    );
    expect(queuesOf(entries)).toEqual(['probe-0.1.0', 'wf-a', 'wf-b']);
  });

  it('leaves out an unserved folder, which has no queue in existence to describe', () => {
    const entries = buildCatalog(input({ actorFolders: [folder({ name: 'draft', version: '0.1.0' })] }));
    expect(entries).toHaveLength(1);
    expect(queuesOf(entries)).toEqual([]);
  });
});

describe('the order is kind, then name', () => {
  it('puts every workflow before every actor', () => {
    // Alphabetical across both would drop `beacon` between two workflows, where it reads as one.
    const entries = buildCatalog(
      input({
        descriptors: [{ name: 'Zulu', savedAt: 1 }],
        actors: [actor({ name: 'alpha', version: '1.0.0' })],
      })
    );
    expect(entries.map((e) => e.kind)).toEqual(['workflow', 'actor']);
  });
});

describe('the filter', () => {
  const entries = buildCatalog(
    input({
      descriptors: [{ name: 'DnsSweep', savedAt: 1, queue: 'q1' }],
      actors: [actor({ name: 'probe', version: '0.1.0' })],
      actorFolders: [folder({ name: 'draft', version: '0.0.1' })],
    })
  );

  it('built something to filter', () => {
    expect(entries).toHaveLength(3);
  });

  it('narrows by kind', () => {
    expect(entries.filter((e) => matchEntry(e, { ...NO_FILTER, kind: 'actor' })).map((e) => e.name)).toEqual([
      'probe',
      'draft',
    ]);
  });

  it('treats an empty chip row as no filter at all, not as "none"', () => {
    // The failure this prevents is a page that goes blank the moment the last chip is cleared.
    expect(entries.every((e) => matchEntry(e, NO_FILTER))).toBe(true);
  });

  it('ORs within a chip row and ANDs across rows', () => {
    const twoStates = entries.filter((e) =>
      matchEntry(e, { ...NO_FILTER, states: ['unserved', 'unknown'] })
    );
    expect(twoStates).toHaveLength(3);
    const andPlace = entries.filter((e) =>
      matchEntry(e, { ...NO_FILTER, states: ['unserved', 'unknown'], places: ['disk'] })
    );
    expect(andPlace.map((e) => e.name)).toEqual(['draft']);
  });

  it('knows when nothing is narrowing, so a clear control is only offered when it would do something', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, q: '   ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTER, q: 'x' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, kind: 'actor' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, states: ['idle'] })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, places: ['disk'] })).toBe(true);
  });
});

describe('the count beside the chips', () => {
  it('names the whole registry as the denominator, never the filtered half', () => {
    expect(resultLabel(4, 23)).toBe('4 of 23 entries');
  });

  it('drops the fraction when nothing is hidden', () => {
    expect(resultLabel(23, 23)).toBe('23 entries');
    expect(resultLabel(1, 1)).toBe('1 entry');
  });

  it('says an empty registry is empty rather than "0 of 0"', () => {
    expect(resultLabel(0, 0)).toBe('nothing registered');
  });
});
