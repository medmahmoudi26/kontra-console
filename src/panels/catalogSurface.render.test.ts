/**
 * The Catalog surface: the states a registry is actually in, drawn.
 *
 * `renderToStaticMarkup` over the props-in half, the way `sideNav.render.test.ts` draws `NavRail`
 * rather than `SideNav`. Everything this file asserts is text and attributes, and every state worth
 * pinning — nothing registered, a filter that matches nothing, a folder listing that failed, each
 * of the three densities — is reachable from a literal and none of them is reachable through the
 * container without a network.
 *
 * THE TWO EMPTINESSES ARE THE POINT. "Nothing is registered" and "your filter hid everything" look
 * identical if either one is allowed to render as a blank grid, and only one of them is the
 * operator's own doing. The count above both is what says so, and it is never conditional.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CatalogSurface, type CatalogSurfaceProps } from './CatalogPage';
import { NO_FILTER, type CatalogEntry } from '@kontra/console-core/panels/catalog';

function entry(over: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'name'>): CatalogEntry {
  return {
    kind: 'actor',
    target: over.name,
    version: '0.1.0',
    description: '',
    state: 'idle',
    place: 'disk',
    path: `/srv/${over.name}`,
    methods: [],
    queue: `${over.name}-0.1.0`,
    haystack: over.name,
    facts: [],
    ...over,
  };
}

const ENTRIES: CatalogEntry[] = [
  entry({ id: 'workflow:dnssweep', name: 'DnsSweep', kind: 'workflow', version: '', state: 'serving' }),
  entry({ id: 'actor:probe@0.1.0', name: 'probe', methods: ['run'], state: 'serving' }),
  entry({ id: 'actor:extract@2.0.0', name: 'extract', place: 'elsewhere', path: '', state: 'idle' }),
];

function draw(over: Partial<CatalogSurfaceProps> = {}): string {
  const props: CatalogSurfaceProps = {
    entries: ENTRIES,
    filter: NO_FILTER,
    layout: 'roomy',
    error: null,
    onFilter: () => {},
    onLayout: () => {},
    onOpen: () => {},
    onRefresh: () => {},
    ...over,
  };
  return renderToStaticMarkup(createElement(CatalogSurface, props));
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the list', () => {
  it('draws every entry', () => {
    const html = draw();
    for (const e of ENTRIES) expect(html, e.name).toContain(`data-testid="catalog-entry-${e.id}"`);
  });

  it('draws the count with the whole registry as the denominator', () => {
    expect(draw()).toContain('data-shown="3" data-total="3"');
    expect(text(draw())).toContain('3 entries');
  });

  it('keeps the denominator when a filter hides entries', () => {
    // A filter that hides two of three must not read as a registry that lost two.
    const html = draw({ filter: { ...NO_FILTER, kind: 'workflow' } });
    expect(html).toContain('data-shown="1" data-total="3"');
    expect(text(html)).toContain('1 of 3 entries');
  });

  it('switches the container between a grid and rows', () => {
    expect(draw({ layout: 'roomy' })).toContain('data-testid="catalog-grid"');
    expect(draw({ layout: 'compact' })).toContain('data-testid="catalog-grid"');
    expect(draw({ layout: 'list' })).toContain('data-testid="catalog-list"');
    expect(draw({ layout: 'list' })).not.toContain('data-testid="catalog-grid"');
  });

  it('marks which density is chosen, so the segmented control is readable', () => {
    expect(draw({ layout: 'compact' })).toContain('data-testid="catalog-layout" data-value="compact"');
  });
});

describe('the two emptinesses are different sentences', () => {
  it('an empty registry says how to put something in it', () => {
    const html = draw({ entries: [] });
    expect(html).toContain('data-testid="catalog-empty"');
    expect(text(html)).toContain('Nothing is registered on this control plane yet');
    // And it names the other half, because a worker on another machine appearing here is the thing
    // an operator would otherwise assume is a bug.
    expect(text(html)).toContain('not on this disk');
  });

  it('a filter that matches nothing blames the filter and still says how many there are', () => {
    const html = draw({ filter: { ...NO_FILTER, q: 'nothing matches this' } });
    expect(html).toContain('data-testid="catalog-none-match"');
    expect(text(html)).toContain('The catalog holds 3 entries');
    expect(html).not.toContain('data-testid="catalog-empty"');
  });

  it('never draws a blank list for either', () => {
    // The failure both of the above exist to prevent, asserted as one statement.
    for (const props of [{ entries: [] }, { filter: { ...NO_FILTER, q: 'zzz' } }]) {
      const html = draw(props);
      expect(html).not.toContain('data-testid="catalog-grid"');
      expect(text(html).length).toBeGreaterThan(120);
    }
  });
});

describe('the filter row', () => {
  it('offers clear only when clearing would do something', () => {
    // A permanent control that does nothing teaches the reader that controls here might not.
    expect(draw()).not.toContain('data-testid="catalog-clear"');
    expect(draw({ filter: { ...NO_FILTER, states: ['idle'] } })).toContain(
      'data-testid="catalog-clear"'
    );
  });

  it('marks which chips are on', () => {
    const html = draw({ filter: { ...NO_FILTER, states: ['serving'], places: ['disk'] } });
    expect(html).toContain('data-testid="catalog-chip-serving" data-on="true"');
    expect(html).toContain('data-testid="catalog-chip-disk" data-on="true"');
    expect(html).toContain('data-testid="catalog-chip-idle"');
    expect(html).not.toContain('data-testid="catalog-chip-idle" data-on="true"');
  });

  it('offers no chip for running, which is the chrome’s question and not this page’s', () => {
    // A chip that filtered a browse page down to what the nav rail's pulse and the Workflows
    // surface both already show would be a fourth answer to a question that has three.
    expect(draw()).not.toContain('data-testid="catalog-chip-running"');
  });

  it('explains each chip in words, because a state is not a colour', () => {
    const html = draw();
    expect(html).toContain('the answer is missing, not negative');
    expect(html).toContain('no worker has ever registered');
  });
});

describe('a failed folder listing', () => {
  it('says so rather than reading as a clean install', () => {
    const html = draw({ entries: [], error: 'sources: ECONNREFUSED' });
    expect(html).toContain('data-testid="catalog-error"');
    expect(text(html)).toContain('ECONNREFUSED');
  });
});
