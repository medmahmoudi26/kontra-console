/**
 * The address, read and written.
 *
 * WHAT IS PINNED HERE IS THE ROUND TRIP, in both directions and for every surface: an address a
 * colleague pasted has to become the store, and the store has to print back the address it came
 * from. Anything that only holds one way round is a link that opens the right page once and then
 * cannot be re-shared from it.
 *
 * AND ONE THING THAT DELIBERATELY DOES NOT ROUND-TRIP: a retired address. `/scratch` still parses —
 * into the address that surface has NOW (the Workflows list) — and prints back as the new one, which
 * is exactly what makes the redirect a fact about the address space rather than a special case at
 * the browser boundary. (`/runs/<id>` used to be here; Runs is a live surface again and round-trips.)
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADDRESS,
  addressOf,
  formatAddress,
  parseAddress,
  stateFor,
  type Address,
  type AddressedState,
} from './address';
import { SURFACES, type View } from './surfaces';

/** A store with nothing open — what the projections start from. */
const RESTING: AddressedState = {
  view: 'workflows',
  workflowName: null,
  runId: null,
  runsRun: null,
  datasetFocus: null,
};

/** URL → Address → store → Address → URL. The whole loop, once, for one address. */
function roundTrip(url: string): { state: Partial<AddressedState>; url: string } {
  const address = parseAddress(url);
  expect(address, `${url} did not parse`).not.toBeNull();
  const state = stateFor(address as Address);
  return { state, url: formatAddress(addressOf({ ...RESTING, ...state })) };
}

describe('the address of a surface', () => {
  const VIEWS: View[] = SURFACES.map((s) => s.id);

  it('covers every surface and no more', () => {
    // THIS IS THE ASSERTION THAT SHOULD HAVE CAUGHT AN UNREACHABLE SURFACE and did not, because it
    // was left saying `all five` while a sixth was being added. Restating the list is the point —
    // deriving it from `SURFACES` would make it true of whatever that module happens to say — so
    // the cost of adding a surface is updating it here, deliberately, once.
    expect(VIEWS).toEqual([
      'catalog',
      'workflows',
      'runs',
      'reports',
      'actors',
      'datasets',
      'logs',
      'secrets',
      'settings',
    ]);
  });

  it.each(VIEWS)('round-trips /%s through the store and back', (view) => {
    const trip = roundTrip(`/${view}`);
    expect(trip.state.view).toBe(view);
    expect(trip.url).toBe(`/${view}`);
  });

  it('lands a cold / on the default surface, and says so in the bar', () => {
    // `/` is a real thing to type and it is not a sixth state: it means Workflows, and the bar is
    // corrected to say Workflows so the address names what is on screen.
    expect(parseAddress('/')).toEqual(DEFAULT_ADDRESS);
    expect(parseAddress('')).toEqual(DEFAULT_ADDRESS);
    expect(formatAddress(DEFAULT_ADDRESS)).toBe('/workflows');
  });

  it('refuses an address this app cannot mean, rather than guessing', () => {
    // `null` is the caller's cue to fall back AND rewrite the bar. Guessing a surface from a near
    // miss would send an operator somewhere they did not ask for and say nothing about it.
    expect(parseAddress('/nope')).toBeNull();
    expect(parseAddress('/workflow')).toBeNull();
    expect(parseAddress('/Runs')).toBeNull();
    expect(parseAddress('/workflows/a/b/c')).toBeNull();
    expect(parseAddress('/datasets/a/b')).toBeNull();
    // A surface with no entity to address cannot carry one.
    expect(parseAddress('/actors/foo')).toBeNull();
    expect(parseAddress('/settings/foo')).toBeNull();
  });

  it('reads a trailing slash as no entity, not as an empty one', () => {
    expect(parseAddress('/workflows/')).toEqual({
      view: 'workflows',
      workflow: null,
      run: null,
    });
    expect(parseAddress('/datasets/')).toEqual({ view: 'datasets', dataset: null });
  });

  it('survives a hash it did not put there', () => {
    expect(parseAddress('/workflows/dnssweep#anything')).toEqual({
      view: 'workflows',
      workflow: 'dnssweep',
      run: null,
    });
  });
});

describe('a workflow and its run in the address', () => {
  it('round-trips the thread on its own', () => {
    const trip = roundTrip('/workflows/dnssweep');
    expect(trip.state).toEqual({
      view: 'workflows',
      workflowName: 'dnssweep',
      runId: null,
    });
    expect(trip.url).toBe('/workflows/dnssweep');
  });

  it('round-trips a run under the workflow that produced it — the link an operator pastes', () => {
    const trip = roundTrip('/workflows/dnssweep/nightly-sweep-2026-08-14');
    expect(trip.state).toEqual({
      view: 'workflows',
      workflowName: 'dnssweep',
      runId: 'nightly-sweep-2026-08-14',
    });
    expect(trip.url).toBe('/workflows/dnssweep/nightly-sweep-2026-08-14');
  });

  it('carries a run whose workflow nobody has resolved, as a query rather than a segment', () => {
    // There is no thread above it to be under, and inventing one would be a URL that reads as a run
    // of a workflow that never produced it.
    const trip = roundTrip('/workflows?run=nscheck-123');
    expect(trip.state).toEqual({
      view: 'workflows',
      workflowName: null,
      runId: 'nscheck-123',
    });
    expect(trip.url).toBe('/workflows?run=nscheck-123');
  });

  it('refuses the second spelling of an address it already has', () => {
    // `/workflows/dnssweep?run=r1` would be `/workflows/dnssweep/r1` said twice; two spellings of
    // one place is a link that does not round-trip.
    expect(parseAddress('/workflows?run=r1&x=2')).toEqual({
      view: 'workflows',
      workflow: null,
      run: 'r1',
    });
    expect(formatAddress({ view: 'workflows', workflow: 'dnssweep', run: 'r1' })).toBe(
      '/workflows/dnssweep/r1'
    );
  });

  it('closes the thread for /workflows with no name — the list is a place too', () => {
    // Not "leave whatever was open": Back out of `/workflows/dnssweep` has to land on the list, and
    // the only thing that can say so is this address writing `null`.
    expect(stateFor({ view: 'workflows', workflow: null, run: null })).toEqual({
      view: 'workflows',
      workflowName: null,
      runId: null,
    });
  });

  it('survives a dot in either id — both are names somebody chose, not names we mint', () => {
    // `safeName` admits `.`, a workflow folder is whatever it is called on disk, and a run started
    // with `--id sweep-v1.2` carries one. `encodeURIComponent` does NOT escape a dot, which is why
    // the server matches the FIRST segment rather than sniffing for a file extension.
    const url = '/workflows/nscheck-0.1.0/sweep-v1.2';
    expect(parseAddress(url)).toEqual({
      view: 'workflows',
      workflow: 'nscheck-0.1.0',
      run: 'sweep-v1.2',
    });
    expect(roundTrip(url).url).toBe(url);
  });

  it('encodes an id that is not path-safe, and reads it back whole', () => {
    const id = 'wf/one two';
    expect(formatAddress({ view: 'workflows', workflow: null, run: id })).toBe(
      '/workflows?run=wf%2Fone%20two'
    );
    expect(formatAddress({ view: 'workflows', workflow: id, run: null })).toBe(
      '/workflows/wf%2Fone%20two'
    );
    expect(parseAddress('/workflows/wf%2Fone%20two')).toEqual({
      view: 'workflows',
      workflow: id,
      run: null,
    });
  });

  it('falls back on a malformed escape rather than throwing at the operator', () => {
    // `decodeURIComponent('%zz')` throws. A URL typed wrong is not a blank page.
    expect(parseAddress('/workflows/%zz')).toBeNull();
  });
});

describe('the runs surface', () => {
  // Runs is a live surface again: `/runs` and `/runs/<id>` are addresses the app owns, so they
  // ROUND-TRIP rather than redirect. The id rides its own store field, not the Workflows `run`.
  it('round-trips the run list', () => {
    expect(parseAddress('/runs')).toEqual({ view: 'runs', run: null });
    expect(formatAddress({ view: 'runs', run: null })).toBe('/runs');
  });

  it('round-trips one run by its id — and does NOT redirect', () => {
    expect(parseAddress('/runs/nscheck-123')).toEqual({ view: 'runs', run: 'nscheck-123' });
    expect(formatAddress({ view: 'runs', run: 'nscheck-123' })).toBe('/runs/nscheck-123');
  });

  it('keeps a dotted run id in the path — the ids this bit us on', () => {
    expect(parseAddress('/runs/sweep-v1.2')).toEqual({ view: 'runs', run: 'sweep-v1.2' });
    expect(formatAddress({ view: 'runs', run: 'sweep-v1.2' })).toBe('/runs/sweep-v1.2');
  });

  // THE REPORT IS THE ONE WORD THAT MAY SIT UNDER A RUN (ADR 0055). A run's record is what
  // `/runs/<id>` has always meant and still means; what the run FOUND is a different page and a
  // different thing to paste, so it gets a segment rather than a query.
  it('refuses a second segment under a run, which it always did', () => {
    // A report is NOT addressed here any more. `/runs/<id>/report` was the first arrangement; it put a
    // second meaning on this surface's path and a second control in its header. Reports have their
    // own surface now, so this refusal is back to exactly what it was.
    expect(parseAddress('/runs/a/b')).toBeNull();
    expect(parseAddress('/runs/a/report')).toBeNull();
  });
});

describe('the reports surface', () => {
  it('round-trips the list', () => {
    expect(parseAddress('/reports')).toEqual({ view: 'reports', run: null });
    expect(formatAddress({ view: 'reports', run: null })).toBe('/reports');
  });

  it('round-trips one report, addressed by the RUN it is of', () => {
    // There is no report id: one Run has one report, with versions inside it.
    expect(parseAddress('/reports/nscheck-123')).toEqual({ view: 'reports', run: 'nscheck-123' });
    expect(formatAddress({ view: 'reports', run: 'nscheck-123' })).toBe('/reports/nscheck-123');
  });

  it('keeps a dotted run id, the shape that bit this app before', () => {
    expect(parseAddress('/reports/sweep-v1.2')).toEqual({ view: 'reports', run: 'sweep-v1.2' });
  });

  it('refuses a second segment', () => {
    expect(parseAddress('/reports/a/b')).toBeNull();
  });

  it('does not disturb the Runs surface: the two carry separate store fields', () => {
    // Opening a report must not silently reselect a run on the page somebody just left — the same
    // rule `runsRun` exists for.
    const state = { ...RESTING, runsRun: 'r1', reportsRun: 'r2' };
    expect(formatAddress(addressOf({ ...state, view: 'runs' }))).toBe('/runs/r1');
    expect(formatAddress(addressOf({ ...state, view: 'reports' }))).toBe('/reports/r2');
  });
});

describe('a retired address', () => {
  it('redirects Scratch to the list, carrying nothing, because it never addressed anything', () => {
    // Scratch is a workflow's own design tab now. It had no entity to hand on: a drawing about
    // nothing is exactly what it was retired for.
    expect(parseAddress('/scratch')).toEqual({
      view: 'workflows',
      workflow: null,
      run: null,
    });
    expect(formatAddress(parseAddress('/scratch') as Address)).toBe('/workflows');
  });

  it('does not invent a depth a retired address never had', () => {
    expect(parseAddress('/runs/a/b')).toBeNull();
    // `/scratch/foo` was not a URL this app could mean before, and being retired is not a licence
    // to start accepting it.
    expect(parseAddress('/scratch/anything')).toBeNull();
  });
});

describe('a Dataset in the address', () => {
  it('round-trips a bare name', () => {
    const trip = roundTrip('/datasets/lame');
    expect(trip.state).toEqual({ view: 'datasets', datasetFocus: { name: 'lame' } });
    expect(trip.url).toBe('/datasets/lame');
  });

  it('round-trips the kind and the Run it was scoped to — the link a Run hands out', () => {
    const trip = roundTrip('/datasets/lame?kind=output&run=nightly-2026-08-15');
    expect(trip.state).toEqual({
      view: 'datasets',
      datasetFocus: { name: 'lame', kind: 'output', run: 'nightly-2026-08-15' },
    });
    expect(trip.url).toBe('/datasets/lame?kind=output&run=nightly-2026-08-15');
  });

  /**
   * The link the run page's "query these rows" button hands out. It carries WHERE to go — the
   * dataset and the run — and not the SQL, which `runScopedSql` composes from exactly these two
   * fields. A URL that carried the text would be a second spelling of the same query.
   */
  it('round-trips the workbench flag, so a query link is shareable', () => {
    const trip = roundTrip('/datasets/canary_signals?run=canary-1790191378&q=1');
    expect(trip.state).toEqual({
      view: 'datasets',
      datasetFocus: { name: 'canary_signals', run: 'canary-1790191378', query: true },
    });
    expect(trip.url).toBe('/datasets/canary_signals?run=canary-1790191378&q=1');
  });

  it('omits the flag when it is not set, rather than writing q=0', () => {
    expect(formatAddress({ view: 'datasets', dataset: { name: 'lame' } })).toBe('/datasets/lame');
    expect(formatAddress({ view: 'datasets', dataset: { name: 'lame', query: false } })).toBe(
      '/datasets/lame'
    );
    expect(parseAddress('/datasets/lame?q=0')).toEqual({ view: 'datasets', dataset: { name: 'lame' } });
  });

  it('keeps "no kind" distinct from "output"', () => {
    // A focus with no kind matches a Dataset of either kind — that is what a link built from a name
    // alone means, and defaulting it to `output` here would silently refuse a standalone list.
    expect(parseAddress('/datasets/lame')).toEqual({
      view: 'datasets',
      dataset: { name: 'lame' },
    });
    expect(formatAddress({ view: 'datasets', dataset: { name: 'lame' } })).toBe('/datasets/lame');
    expect(formatAddress({ view: 'datasets', dataset: { name: 'lame', kind: 'output' } })).toBe(
      '/datasets/lame?kind=output'
    );
  });

  it('round-trips a standalone list', () => {
    const trip = roundTrip('/datasets/scope?kind=standalone');
    expect(trip.state).toEqual({
      view: 'datasets',
      datasetFocus: { name: 'scope', kind: 'standalone' },
    });
    expect(trip.url).toBe('/datasets/scope?kind=standalone');
  });

  it('round-trips a name with a dot in it', () => {
    // `safeName` (data/parquet.ts) permits `.`, so `acme.com` is a Dataset somebody really has.
    expect(roundTrip('/datasets/acme.com').url).toBe('/datasets/acme.com');
  });

  it('drops a query it does not understand instead of refusing the address', () => {
    // Strict about the path, lenient about the query: a stale `?kind=` from some older link still
    // opens the Dataset, and the bar is corrected on arrival.
    expect(parseAddress('/datasets/lame?kind=banana&run=')).toEqual({
      view: 'datasets',
      dataset: { name: 'lame' },
    });
    expect(parseAddress('/datasets/lame?utm_source=slack')).toEqual({
      view: 'datasets',
      dataset: { name: 'lame' },
    });
  });
});

describe('the projection of a store', () => {
  it('addresses only the surface on screen', () => {
    // `setRunId` on the Datasets page changes the Workflows surface's selection without navigating
    // — the store's own rule. The bar has to agree: `/datasets`, because that is what is rendered.
    // The id is not lost, it is simply not this page's address.
    const url = formatAddress(
      addressOf({ ...RESTING, view: 'datasets', runId: 'r1', datasetFocus: null })
    );
    expect(url).toBe('/datasets');
  });

  it('writes only its own surface fields, so Back does not blank a neighbour', () => {
    // Back from `/workflows/dnssweep/r1` to `/datasets/lame` must not clear `workflowName`: a
    // Datasets address says nothing about the Workflows surface's selection.
    expect(stateFor({ view: 'datasets', dataset: { name: 'lame' } })).not.toHaveProperty(
      'workflowName'
    );
    expect(stateFor({ view: 'workflows', workflow: 'w', run: 'r1' })).not.toHaveProperty(
      'datasetFocus'
    );
    expect(stateFor({ view: 'settings' })).toEqual({ view: 'settings' });
  });
});
