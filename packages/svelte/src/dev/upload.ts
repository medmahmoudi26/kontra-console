/**
 * Bytes to the object store, and a ref back.
 *
 * ── WHY THIS IS NOT INSIDE THE COMPONENT ────────────────────────────────────────────────────────
 *
 * A drop is the one place in a form where things go wrong for reasons the form did not cause: a
 * file too large for the route, a folder with 900 entries, a session that expired between the drop
 * and the second file. Each of those is a sentence somebody has to read, so the progression is a
 * value here rather than four booleans in a component — and it can be tested without a browser.
 *
 * ── ONE FILE AT A TIME, ON PURPOSE ──────────────────────────────────────────────────────────────
 *
 * A folder drop is N uploads and they run in sequence. Parallel would be faster and would also open
 * N sockets against a control plane that may be a 2 GB droplet; the uploads are bounded by disk and
 * hash anyway, and a serial loop is what lets the count say `3 of 12` truthfully instead of
 * `12 in flight`.
 *
 * ── A FAILED UPLOAD KEEPS WHAT LANDED ───────────────────────────────────────────────────────────
 *
 * Nine files in and the tenth 413s: the nine are uploaded, they exist, and throwing them away would
 * mean re-sending bytes the store already has. The result carries both — what landed and what went
 * wrong — and the field shows the partial state rather than reverting to empty, which would read as
 * "nothing happened" when a lot did.
 */
import { uploadBlob } from '@kontra/console-core/run/api';

import type { BlobRef } from './payload';

/** How far a drop has got. `done` may still carry an `error` — see the file header. */
export type Upload =
  | { state: 'idle' }
  | { state: 'uploading'; done: number; total: number; name: string }
  | { state: 'done'; refs: BlobRef[]; error?: string };

/**
 * The path a folder drop carries, as the browser gives it.
 *
 * `webkitRelativePath` is how a directory `<input>` reports structure and it is the ONLY place that
 * structure exists: the upload route deliberately reduces a name to its last segment, because a
 * name that travels into an actor must not be a path. So it is read here and kept here.
 */
function relativePathOf(file: File): string | undefined {
  const p = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return p === undefined || p === '' ? undefined : p;
}

/**
 * Upload every file, reporting after each one.
 *
 * `onprogress` is called before the first byte goes out, so a 40 MB drop says what it is doing
 * immediately rather than after the first upload returns.
 */
export async function uploadAll(
  files: readonly File[],
  onprogress: (u: Upload) => void,
  upload: (f: File, p?: string) => Promise<BlobRef> = uploadBlob
): Promise<Upload> {
  if (files.length === 0) return { state: 'done', refs: [] };
  const refs: BlobRef[] = [];
  for (const [i, file] of files.entries()) {
    onprogress({ state: 'uploading', done: i, total: files.length, name: file.name });
    try {
      refs.push(await upload(file, relativePathOf(file)));
    } catch (err) {
      // NAMED, AND THE FILE IS NAMED. "upload failed" against a 200-file folder drop is not an
      // actionable sentence; which file, and what the server said, is.
      const said = err instanceof Error ? err.message : String(err);
      return { state: 'done', refs, error: `${file.name}: ${said}` };
    }
  }
  return { state: 'done', refs };
}

/** What a finished upload puts in the field: one ref for a file, a list for a folder. */
export function fieldValueOf(control: 'file' | 'folder', refs: readonly BlobRef[]): BlobRef | { files: BlobRef[] } | undefined {
  if (refs.length === 0) return undefined;
  return control === 'folder' ? { files: [...refs] } : refs[0];
}

/**
 * The files in a drop, flattened.
 *
 * A FOLDER DROP IS NOT `dataTransfer.files`. Dropping a directory puts ONE entry in `items` whose
 * `webkitGetAsEntry()` is a directory — `files` is empty or holds the directory itself depending on
 * the browser — so a form that reads `files` alone silently accepts a folder drop and uploads
 * nothing. This walks the entry tree, which is the only way the structure survives.
 */
export async function filesFrom(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items]
    .map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return [...dt.files];
  const out: File[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((done) => {
      (entry as FileSystemFileEntry).file(
        (f) => done(withPath(f, entry.fullPath)),
        () => done(null)
      );
    });
    if (file) out.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // `readEntries` RETURNS A PAGE, not the directory. Chromium answers at most 100 entries per call
  // and signals the end with an empty array — a single call silently truncates a folder of 340
  // files to its first hundred, and every file present makes that look like it worked.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((done) => {
      reader.readEntries(
        (es) => done(es),
        () => done([])
      );
    });
    if (batch.length === 0) return;
    for (const child of batch) await walk(child, out);
  }
}

/**
 * Re-stamp a dropped file with the path the entry walk knows.
 *
 * A `File` from `FileSystemFileEntry.file()` has an EMPTY `webkitRelativePath` — the structure is in
 * the entry's `fullPath` and nowhere else — so without this a dropped folder uploads as a flat pile
 * of names and `corpus/a/1.txt` and `corpus/b/1.txt` collide inside the actor.
 */
function withPath(file: File, fullPath: string): File {
  const rel = fullPath.replace(/^\//, '');
  if (rel === '' || rel === file.name) return file;
  Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true });
  return file;
}
