/**
 * What a registry entry SAYS, and — twice as important here — what it offers.
 *
 * THE SHARP ASSERTION IS THE NEGATIVE ONE. An entry whose code is on no disk here has no row on the
 * Actors surface and no row on the Workflows surface, because both list one row per registered
 * folder. A card that looked clickable would hand the operator to a page that answers "no Actor
 * matches this filter" — a dead end dressed as a destination — so this pins that such a card is not
 * a button at all, at every density, and that it still carries every fact it had.
 *
 * The rest is the vocabulary: `unserved` says its Methods are UNKNOWN rather than none, and an
 * undescribed entry says so rather than leaving a gap that reads as a failed load.
 */

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CatalogCard, type CardLayout } from './CatalogCard';
import type { CatalogEntry } from '@kontra/console-core/panels/catalog';

const LAYOUTS: CardLayout[] = ['roomy', 'compact', 'list'];

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'actor:probe@0.1.0',
    kind: 'actor',
    name: 'probe',
    target: 'probe',
    version: '0.1.0',
    description: 'knock on a host and report what answered',
    state: 'serving',
    place: 'disk',
    path: '/srv/probe',
    methods: ['run'],
    queue: 'probe-0.1.0',
    haystack: 'probe run',
    facts: [{ label: 'methods', value: '1', title: 'Methods this version declares' }],
    ...over,
  };
}

function render(e: CatalogEntry, layout: CardLayout = 'roomy'): string {
  return renderToStaticMarkup(
    createElement(CatalogCard, { entry: e, layout, onOpen: () => {} })
  );
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

describe('an entry you can reach', () => {
  it('is a button at every density', () => {
    for (const layout of LAYOUTS) {
      const html = render(entry(), layout);
      expect(html.startsWith('<button'), layout).toBe(true);
      expect(html, layout).toContain('data-reachable="true"');
    }
  });

  it('keeps the four facts that say what it IS, at every density', () => {
    // A list row that dropped the state would make the densest view the one that says least about
    // what is happening, which is backwards.
    for (const layout of LAYOUTS) {
      const html = render(entry(), layout);
      expect(html, layout).toContain('data-kind="actor"');
      expect(html, layout).toContain('data-state="serving"');
      expect(html, layout).toContain('data-place="disk"');
      expect(text(html), layout).toContain('probe');
      expect(text(html), layout).toContain('0.1.0');
    }
  });
});

describe('an entry whose code is on no disk here', () => {
  const away = entry({ place: 'elsewhere', path: '' });

  it('is NOT a button, at any density', () => {
    // Both work surfaces list one row per registered folder, so there is nowhere for this to open.
    // `SideNav`'s pulse settled the same question the same way: a control that navigates nowhere is
    // worse than a line of text that never claimed it would.
    for (const layout of LAYOUTS) {
      const html = render(away, layout);
      expect(html.startsWith('<button'), layout).toBe(false);
      expect(html, layout).not.toContain('data-reachable');
    }
  });

  it('still says everything it knows, and says why there is no way in', () => {
    const html = render(away);
    expect(text(html)).toContain('knock on a host');
    expect(text(html)).toContain('not on this disk');
    expect(html).toContain('data-state="serving"');
    // The explanation is on the card itself, not only on the badge: the badge is small and easy to
    // miss, and "why can I not open this" is the question the whole card raises.
    expect(html).toContain('nothing here to open, edit, serve or forget');
  });

  it('is the same markup as a reachable one apart from the element and the hover', () => {
    // Non-vacuous partner: if the unreachable branch quietly dropped content, the case above would
    // still pass on whatever it happened to keep.
    const reachable = text(render(entry()));
    const unreachable = text(render(away));
    for (const word of ['probe', '0.1.0', 'knock on a host', 'run', 'methods']) {
      expect(reachable, word).toContain(word);
      expect(unreachable, word).toContain(word);
    }
  });
});

describe('the Methods line', () => {
  it('says UNKNOWN for an unserved folder, not "no methods"', () => {
    // Nothing has registered it, so nobody has established what it declares. Printing "declares no
    // Methods" would state something no worker has said.
    const html = render(entry({ state: 'unserved', methods: [], facts: [] }));
    expect(text(html)).toContain('methods unknown — nothing has served this yet');
  });

  it('says NONE for a registered actor that declared none', () => {
    const html = render(entry({ state: 'idle', methods: [], facts: [] }));
    expect(text(html)).toContain('declares no Methods');
    expect(text(html)).not.toContain('unknown');
  });

  it('lists them, and stops counting out loud past six', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const html = render(entry({ methods: many }));
    for (const m of many.slice(0, 6)) expect(text(html), m).toContain(m);
    expect(text(html)).toContain('+2');
  });

  it('is not drawn for a workflow, which has no Methods to draw', () => {
    const html = render(entry({ kind: 'workflow', methods: [], version: '', facts: [] }));
    expect(html).not.toContain('catalog-methods');
  });
});

describe('an undescribed entry', () => {
  it('says so rather than leaving a gap that reads as a failed load', () => {
    const html = render(entry({ description: '' }));
    expect(text(html)).toContain('no description');
  });
});
