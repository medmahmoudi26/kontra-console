/**
 * Markdown for the widget path, with no way to render HTML.
 *
 * ── THE GUARD COMES WITH IT ─────────────────────────────────────────────────────────────────────
 *
 * `untrusted.test.ts` in the React console scans every widget source for `rehype-raw`,
 * `dangerouslySetInnerHTML`, `innerHTML` and `outerHTML`, because what renders here is text a
 * MACHINE wrote — a Terminal's output, a `speak()` line, a run's summary — and none of it is ours
 * to trust. Replacing `react-markdown` without carrying that rule over would quietly remove the
 * boundary while the tests that guarded it stayed green in a package nobody looks at.
 *
 * ── SO THIS RENDERS A SMALL SUBSET AND ESCAPES EVERYTHING ELSE ──────────────────────────────────
 *
 * Bold, italic, inline code, links with an explicit protocol allowlist, and paragraphs. Every other
 * byte is escaped before any pattern is applied — escape first, then format, so a `<script>` in the
 * source can never become a tag no matter what the formatter does with the characters around it.
 *
 * A markdown LIBRARY would be the obvious choice and is the one that goes wrong: every one of them
 * has an HTML passthrough, most have it on by default, and turning it off is a configuration
 * somebody can change without noticing what it was for.
 */

/** Escape first. Everything below operates on already-safe text. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Protocols a link may use. `javascript:` and `data:` are the two this exists to exclude. */
const SAFE_LINK = /^(https?:\/\/|mailto:|\/)/i;

export function renderMarkdown(src: string): string {
  const escaped = escapeHtml(src);
  return escaped
    .split(/\n{2,}/)
    .map((para) => {
      const body = para
        // `code` first: nothing inside a span should be formatted further.
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) =>
          // A LINK THAT IS NOT ALLOWED RENDERS AS TEXT, not as nothing: dropping it silently hides
          // that something was there, and hiding is how a reader stops trusting the rendering.
          SAFE_LINK.test(href)
            ? `<a href="${href}" rel="noopener noreferrer" target="_blank">${text}</a>`
            : `${text} (${href})`
        )
        .replace(/\n/g, '<br>');
      return `<p>${body}</p>`;
    })
    .join('');
}
