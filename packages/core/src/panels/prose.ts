/**
 * An author's paragraph, as text a surface can put in a `<p>`.
 *
 * ── WHY THIS EXISTS: TWO SOURCES, ONE SLOT, AND ONLY ONE OF THEM IS PLAIN ──────────────────────
 *
 * A workflow's description reaches the console down two paths, and the form shows whichever it
 * has:
 *
 *   - the serving worker's descriptor — `first_paragraph(cls.__doc__)`, a Python docstring, which
 *     is plain prose and needs nothing done to it;
 *   - the folder's `description.md` — the first paragraph of a MARKDOWN file, which arrives with
 *     its markup intact.
 *
 * So the canary's own paragraph rendered on screen as `**Provisions a Fleet, sweeps on it…**`,
 * asterisks and all. That is not a styling miss: it is markup shown to somebody who never asked
 * for a source view.
 *
 * ── IT STRIPS; IT DOES NOT RENDER ──────────────────────────────────────────────────────────────
 *
 * The alternative was a markdown renderer, and this console does not have one — nor should it
 * acquire one to print a sentence. Rendering markdown from a file on the operator's disk into the
 * page also means deciding what to do about `<script>` and about links, which is a security
 * question this has no business opening days before a public release. Stripping the four inline
 * markers an author actually uses in a lead paragraph answers the whole problem and adds no
 * surface: the output is TEXT, and every caller interpolates it as text.
 *
 * BLOCK MARKDOWN IS LEFT ALONE. A heading or a bullet in a lead paragraph is the author saying
 * something this does not understand, and silently eating the `#` would misrepresent it. Only
 * emphasis, code spans and link syntax — the things that appear mid-sentence — are unwrapped.
 */

/**
 * `**bold**`, `*italic*`, `` `code` `` and `[text](href)` reduced to what they say.
 *
 * Order matters: the two-character emphasis markers go before the one-character ones, or `**x**`
 * leaves a stray asterisk at each end. Link text survives and the href does not, because a
 * paragraph in a `<p>` cannot be clicked and printing a bare URL mid-sentence is worse than
 * dropping it.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}
