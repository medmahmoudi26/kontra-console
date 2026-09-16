import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown';

/**
 * What renders here is text a MACHINE wrote — a Terminal's output, a `speak()` line. None of it is
 * ours to trust, which is why the React console has `untrusted.test.ts` scanning for raw-HTML
 * escape hatches and why replacing `react-markdown` has to carry that rule rather than drop it.
 */
describe('markdown that cannot render HTML', () => {
  it('escapes a script tag instead of rendering it', () => {
    const out = renderMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes an img with an onerror, which is the payload that does not need script tags', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('refuses a javascript: link and shows it as text rather than dropping it', () => {
    // Dropping it silently hides that something was there, and hiding is how a reader stops
    // trusting what they are being shown.
    const out = renderMarkdown('[click](javascript:alert(1))');
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('click');
    expect(out).toContain('javascript:alert(1)');
  });

  it('refuses a data: link too', () => {
    expect(renderMarkdown('[x](data:text/html,<b>)')).not.toContain('href="data:');
  });

  it('allows http, https, mailto and a site-relative path', () => {
    for (const href of ['https://example.com', 'http://example.com', 'mailto:a@b.c', '/runs/x']) {
      expect(renderMarkdown(`[t](${href})`), href).toContain(`href="${href}"`);
    }
  });

  it('opens external links without handing over the opener', () => {
    expect(renderMarkdown('[t](https://example.com)')).toContain('rel="noopener noreferrer"');
  });

  it('still does the formatting it is for', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('`code`')).toContain('<code>code</code>');
    expect(renderMarkdown('a\n\nb')).toBe('<p>a</p><p>b</p>');
  });

  it('escapes BEFORE formatting, so markup cannot be assembled from the pieces', () => {
    // The ordering that matters: format-then-escape would let `**<`+`script>**` become a tag.
    const out = renderMarkdown('**<script>**');
    expect(out).not.toContain('<script');
  });
});
