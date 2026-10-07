/**
 * READING ONE RUN'S REPORT: two requests, each allowed to fail on its own.
 *
 * ── THE PAGE IS NEVER BLANK AND NEVER LIES ─────────────────────────────────────────────────────
 *
 * The report and the thread are separate reads, so a thread that 500s must not take the report down
 * with it — and a report that is genuinely absent must not look like one that failed to load. Both are
 * degraded to their empty value and the failure is NAMED, which is the rule `infra/load.ts` states and
 * the reason it states it: a page that shows nothing and says nothing teaches an operator to distrust
 * every empty page.
 *
 * A 404 on the report is NOT a failure. Most runs that finish before the renderer reaches them have no
 * report for a few minutes, and a run from before this feature existed has none at all. That is
 * `absent`, which the page says in words.
 */

import type {
  FeedbackNote,
  ReportListRow,
  ReportVersionRow,
  ReportVersionView,
} from '@kontra/console-core/report/snapshot';

import type { Missing } from '../infra/load';

const BASE = '/api';

export interface ReportPage {
  runId: string;
  /** The report, or `null` when this run has none — which is a state and not an error. */
  report: ReportVersionView | null;
  versions: ReportVersionRow[];
  notes: FeedbackNote[];
  /** Every read that did not answer, each named. Empty on a healthy page. */
  missing: Missing[];
  /** True when the report read came back 404 — "no report yet", which the page explains. */
  absent: boolean;
}

function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Load the page.
 *
 * `fetchImpl` IS AN ARGUMENT, as every loader in this repo takes it: that is what makes the loader
 * testable without a browser and what lets an e2e stub route every call.
 */
export async function loadReport(
  runId: string,
  fetchImpl: typeof fetch = fetch,
  version?: number
): Promise<ReportPage> {
  const page: ReportPage = { runId, report: null, versions: [], notes: [], missing: [], absent: false };
  const id = encodeURIComponent(runId);

  const reportUrl = `${BASE}/runs/${id}/report${version !== undefined ? `?version=${version}` : ''}`;
  try {
    const res = await fetchImpl(reportUrl, { credentials: 'same-origin' });
    if (res.status === 404) {
      page.absent = true;
    } else if (!res.ok) {
      page.missing.push({ url: reportUrl, status: res.status, why: `the report read answered ${res.status}` });
    } else {
      page.report = (await res.json()) as ReportVersionView;
    }
  } catch (err) {
    page.missing.push({ url: reportUrl, status: 0, why: why(err) });
  }

  // THE VERSION LIST IS ONLY ASKED FOR WHEN THERE IS A REPORT. A run with none has no versions by
  // definition, and a second 404 in the `missing` list would be noise about a state the page already
  // explains.
  if (page.report !== null) {
    const url = `${BASE}/runs/${id}/report/versions`;
    try {
      const res = await fetchImpl(url, { credentials: 'same-origin' });
      if (res.ok) page.versions = ((await res.json()) as { versions: ReportVersionRow[] }).versions ?? [];
      else page.missing.push({ url, status: res.status, why: `the version list answered ${res.status}` });
    } catch (err) {
      page.missing.push({ url, status: 0, why: why(err) });
    }
  }

  const feedbackUrl = `${BASE}/runs/${id}/feedback`;
  try {
    const res = await fetchImpl(feedbackUrl, { credentials: 'same-origin' });
    if (res.ok) page.notes = ((await res.json()) as { notes: FeedbackNote[] }).notes ?? [];
    else page.missing.push({ url: feedbackUrl, status: res.status, why: `the feedback read answered ${res.status}` });
  } catch (err) {
    page.missing.push({ url: feedbackUrl, status: 0, why: why(err) });
  }

  return page;
}

/** Post one note. Returns the created note, or throws with a sentence the composer shows. */
export async function postNote(
  runId: string,
  body: string,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackNote> {
  const res = await fetchImpl(`${BASE}/runs/${encodeURIComponent(runId)}/feedback`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    // THE SERVER'S OWN SENTENCE, not a paraphrase: it knows why it refused — an empty note, a note over
    // the byte cap, a credential the browser does not carry — and each has a different fix.
    const said = await res.text().catch(() => '');
    let message = `the note was refused (${res.status})`;
    try {
      const parsed = JSON.parse(said) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (said !== '') message = said;
    }
    throw new Error(message);
  }
  return (await res.json()) as FeedbackNote;
}

/** `2 min ago`, `3h ago`, `12 Oct` — a time a person reads rather than an ISO instant. */
export function ago(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days}d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The initial on a note's avatar. A token's note shows a dot rather than a letter — it is not a person. */
export function initialOf(note: Pick<FeedbackNote, 'author' | 'authorKind'>): string {
  if (note.authorKind === 'token') return '·';
  const first = note.author.trim()[0];
  return first ? first.toUpperCase() : '?';
}

/** The Reports surface's listing: every Run that has one, newest first. */
export interface ReportListing {
  rows: ReportListRow[];
  missing: Missing[];
}

/**
 * Every report this control plane has rendered.
 *
 * ONE READ, and a failure is NAMED rather than drawn as an empty list — the distinction this module
 * keeps everywhere: "nothing has been rendered yet" and "the listing could not be read" are different
 * facts with different fixes, and a page that shows nothing for both teaches an operator to distrust
 * every empty page.
 */
export async function loadReportList(fetchImpl: typeof fetch = fetch): Promise<ReportListing> {
  const url = `${BASE}/reports`;
  try {
    const res = await fetchImpl(url, { credentials: 'same-origin' });
    if (!res.ok) {
      return { rows: [], missing: [{ url, status: res.status, why: `the listing answered ${res.status}` }] };
    }
    return { rows: ((await res.json()) as { reports?: ReportListRow[] }).reports ?? [], missing: [] };
  } catch (err) {
    return { rows: [], missing: [{ url, status: 0, why: why(err) }] };
  }
}
