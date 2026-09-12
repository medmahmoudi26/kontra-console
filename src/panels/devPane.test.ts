/**
 * The embeddable pane's addressing, and the one property that is a security decision.
 *
 * A HOST CAN ONLY HAND A CREDENTIAL OVER IN THE URL. An iframe has no other channel before its
 * first paint. But a bearer that LIVES in the address ends up in history, in referrers and in any
 * log that records a path — which is most of what ADR 0045 was written to stop. So the token is
 * consumed and REMOVED, and this file is where that is asserted: the removal is a side effect on
 * `history`, so `readDevRequest` returns the stripped address rather than performing the strip,
 * precisely so it can be checked without a browser.
 */

import { describe, expect, it } from 'vitest';

import { isDevRoute, readDevRequest } from './DevPane';

const at = (href: string) => readDevRequest(new URL(href, 'http://localhost:8088'));

describe('the dev route', () => {
  it('is only /dev', () => {
    expect(isDevRoute('/dev')).toBe(true);
    expect(isDevRoute('/dev/')).toBe(true);
    // Not a prefix match: `/development` is somebody else's page.
    expect(isDevRoute('/development')).toBe(false);
    expect(isDevRoute('/')).toBe(false);
    expect(isDevRoute('/actors')).toBe(false);
  });
});

describe('addressing', () => {
  it('reads the actor and method', () => {
    const { request } = at('/dev?actor=nscheck@0.1.0&method=probe');
    expect(request.actorKey).toBe('nscheck@0.1.0');
    expect(request.method).toBe('probe');
  });

  it('accepts only the two themes it understands', () => {
    expect(at('/dev?theme=dark').request.theme).toBe('dark');
    expect(at('/dev?theme=light').request.theme).toBe('light');
    // Anything else leaves the viewer's own preference alone rather than guessing.
    expect(at('/dev?theme=solarized').request.theme).toBeUndefined();
    expect(at('/dev').request.theme).toBeUndefined();
  });

  it('survives a missing actor rather than inventing one', () => {
    expect(at('/dev').request.actorKey).toBe('');
  });
});

describe('the token never stays in the address', () => {
  it('is taken out, and everything else is left alone', () => {
    const { token, stripped, request } = at(
      '/dev?actor=nscheck@0.1.0&method=probe&theme=dark&token=SECRET-abc123'
    );
    expect(token).toBe('SECRET-abc123');
    expect(stripped).not.toContain('SECRET-abc123');
    expect(stripped).not.toContain('token');
    // The rest of the address is untouched — stripping must not also lose the addressing.
    expect(stripped).toContain('actor=nscheck%400.1.0');
    expect(stripped).toContain('method=probe');
    expect(stripped).toContain('theme=dark');
    expect(request.actorKey).toBe('nscheck@0.1.0');
  });

  it('leaves an address with no token unchanged', () => {
    const { token, stripped } = at('/dev?actor=a@1&method=m');
    expect(token).toBe('');
    expect(stripped).toBe('/dev?actor=a%401&method=m');
  });

  it('strips the token even when it is the only parameter', () => {
    const { stripped } = at('/dev?token=SECRET');
    expect(stripped).toBe('/dev');
    expect(stripped).not.toContain('SECRET');
  });

  it('keeps a fragment, which a host may use', () => {
    const { stripped } = at('/dev?token=SECRET#pane');
    expect(stripped).toBe('/dev#pane');
  });
});
