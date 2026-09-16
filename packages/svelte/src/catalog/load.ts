/**
 * Everything `buildCatalog` needs, fetched once and assembled.
 *
 * ── SEVEN REQUESTS, ONE VIEW ────────────────────────────────────────────────────────────────────
 *
 * The Catalog is a JOIN across what is registered on disk, what workers have published, what has
 * run, and what is currently polling — and no endpoint answers that question. Assembling it here
 * rather than adding a `/api/catalog` keeps the join in `@kontra/console-core`, where the React
 * console already has it and where both consoles read the same answer.
 *
 * ── A FAILED PART IS EMPTY, NOT FATAL ───────────────────────────────────────────────────────────
 *
 * A catalog with no poller data is still a catalog; it just cannot say what is serving. Failing the
 * whole surface because one of seven calls 404'd on an older control plane would make the console
 * less useful than the thing it is describing. Each part degrades to its empty value and the page
 * says which ones it could not read.
 */
import { buildCatalog, type CatalogEntry, type CatalogInput } from '@kontra/console-core/panels/catalog';

export interface Loaded {
  entries: CatalogEntry[];
  /** Endpoints that did not answer. Rendered, because a silently partial list is a lie. */
  degraded: string[];
}

async function part<T>(url: string, fallback: T, degraded: string[], fetchImpl: typeof fetch): Promise<T> {
  try {
    const res = await fetchImpl(url, { credentials: 'same-origin' });
    if (!res.ok) {
      degraded.push(url);
      return fallback;
    }
    return (await res.json()) as T;
  } catch {
    degraded.push(url);
    return fallback;
  }
}

export async function loadCatalog(fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<Loaded> {
  const degraded: string[] = [];
  const g = <T,>(url: string, fallback: T) => part<T>(url, fallback, degraded, fetchImpl);

  const [wf, af, descriptors, runs, actors, pollers, files] = await Promise.all([
    g<{ sources?: CatalogInput['workflowFolders'] }>('/api/sources/workflow', {}),
    g<{ sources?: CatalogInput['actorFolders'] }>('/api/sources/actor', {}),
    g<CatalogInput['descriptors']>('/api/workflows/catalog', []),
    g<CatalogInput['runs']>('/api/runs', []),
    g<CatalogInput['actors']>('/api/actors', []),
    g<CatalogInput['pollers']>('/api/pollers', {}),
    g<CatalogInput['workflowFiles']>('/api/workflows', []),
  ]);

  const entries = buildCatalog({
    workflowFolders: wf.sources ?? [],
    actorFolders: af.sources ?? [],
    workflowFiles: Array.isArray(files) ? files : [],
    descriptors: Array.isArray(descriptors) ? descriptors : [],
    runs: Array.isArray(runs) ? runs : [],
    actors: Array.isArray(actors) ? actors : [],
    pollers: pollers ?? {},
    now,
  });
  return { entries, degraded };
}
