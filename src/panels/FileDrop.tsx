/**
 * A `File` or `Folder` field: drag something in, and the field holds the ref the actor dereferences.
 *
 * ── WHAT THE FIELD ACTUALLY HOLDS ───────────────────────────────────────────────────────────────
 *
 * A JSON STRING, like every other field on these forms. `formFields.ts` keeps one flat
 * `Record<string, string>` and `coerceField` turns each value into what its declared type says —
 * and a `kontra.File` is a `$ref`ed model, so it already goes through the JSON arm. That is why
 * this component needs no coercion of its own, no new value type, and no change to either form: the
 * drop zone is a different way of TYPING the same string a box could have held.
 *
 * The shape is exactly what `POST /api/uploads` answered — `{name, sha256, size, contentType}`,
 * plus `path` inside a folder — so what the actor receives is what the store confirmed, never what
 * the browser claimed.
 *
 * ── WHY UPLOAD RATHER THAN INLINE ───────────────────────────────────────────────────────────────
 *
 * A workflow argument goes into workflow history. A 40 MB corpus inlined into one is 40 MB of
 * history Temporal will refuse, or that the claim-check codec offloads a second time on its way
 * past. Uploading first is the same claim-check, performed where the operator can see it fail.
 *
 * ── DRAG IS NOT THE ONLY WAY IN ─────────────────────────────────────────────────────────────────
 *
 * The zone is also a BUTTON that opens the file picker, and the hidden `<input type="file">` is
 * what makes that work. Drag-and-drop is undiscoverable on its own, impossible from a keyboard, and
 * unavailable in a remote session where the files are on the other machine — so the picker is the
 * accessible path and the drop is the convenience, not the reverse.
 *
 * A FOLDER USES `webkitdirectory`, which every current browser implements under that prefixed name
 * and which is the only way to choose a directory at all. Dropping a directory goes through
 * `webkitGetAsEntry` for the same reason. Both are feature-detected rather than assumed: a browser
 * without them still gets the multi-file picker, which is the same job with more clicks.
 */

import { useCallback, useRef, useState } from 'react';
import { File as FileIcon, FolderOpen, Loader2, Upload, X } from 'lucide-react';

import { uploadBlob, type UploadedBlob } from '@kontra/console-core/run/api';

/** Bytes, said the way a person reads them. `1.2 kB`, not `1229`. */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
  if (bytes < 1000 * 1000 * 1000) return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
  return `${(bytes / 1000 / 1000 / 1000).toFixed(2)} GB`;
}

/**
 * What is in the field right now, read back from its string.
 *
 * TOLERANT ON PURPOSE, AND IT RETURNS `null` RATHER THAN THROWING. The value can be anything: blank
 * (nothing chosen), a ref this component wrote, or a draft an operator typed or pasted by hand —
 * which is still legal, because the underlying field is a JSON one and always was. A parse failure
 * is a value this control cannot DRAW, never a value it may discard.
 */
export function readRef(value: string, folder: boolean): UploadedBlob[] | null {
  if (value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (folder) {
      const files = (parsed as { files?: unknown })?.files;
      return Array.isArray(files) ? (files as UploadedBlob[]) : null;
    }
    return parsed !== null && typeof parsed === 'object' && 'sha256' in parsed
      ? [parsed as UploadedBlob]
      : null;
  } catch {
    return null;
  }
}

/** The field's string for a set of uploaded files. A folder keeps its name and its listing. */
function writeRef(files: UploadedBlob[], folder: boolean, folderName: string): string {
  if (files.length === 0) return '';
  if (!folder) return JSON.stringify(files[0]);
  return JSON.stringify({ name: folderName, files });
}

/**
 * Every file under a dropped directory, in order.
 *
 * `DataTransferItem.webkitGetAsEntry()` IS THE ONLY WAY TO SEE INSIDE A DROPPED FOLDER. `e.dataTransfer.files`
 * lists a directory as ONE entry with size 0 and no way to open it, so a folder drop without this
 * silently uploads a zero-byte nothing named after the directory. Feature-detected: a browser that
 * does not implement it gets whatever `files` holds, which for a single file is correct.
 */
async function filesFromDrop(transfer: DataTransfer): Promise<Array<{ file: File; path: string }>> {
  const entries = Array.from(transfer.items)
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) {
    return Array.from(transfer.files).map((file) => ({ file, path: file.name }));
  }
  const out: Array<{ file: File; path: string }> = [];
  for (const entry of entries) await walk(entry, '', out);
  return out;
}

async function walk(
  entry: FileSystemEntry,
  prefix: string,
  out: Array<{ file: File; path: string }>
): Promise<void> {
  const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null))
    );
    if (file) out.push({ file, path });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  /* `readEntries` RETURNS A PAGE, NOT THE DIRECTORY. The API is specified to answer at most ~100
     entries per call and to signal the end with an EMPTY array, so a single call silently truncates
     any folder larger than that — a corpus of 400 files would upload 100 of them and report
     success. Read until empty. */
  for (;;) {
    const page = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([]))
    );
    if (page.length === 0) break;
    for (const child of page) await walk(child, path, out);
  }
}

export interface FileDropProps {
  /** `folder` collects a directory; `file` collects one file. */
  kind: 'file' | 'folder';
  value: string;
  onChange(next: string): void;
  testId: string;
  /** Injected so a test can drive the whole component without a network. Defaults to the real one. */
  upload?: (file: File, relativePath?: string) => Promise<UploadedBlob>;
}

export function FileDrop({
  kind,
  value,
  onChange,
  testId,
  upload = uploadBlob,
}: FileDropProps): JSX.Element {
  const folder = kind === 'folder';
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const held = readRef(value, folder);
  const folderName = folder ? ((): string => {
    try {
      return String((JSON.parse(value || '{}') as { name?: unknown }).name ?? '');
    } catch {
      return '';
    }
  })() : '';

  const take = useCallback(
    async (picked: Array<{ file: File; path: string }>) => {
      if (picked.length === 0) return;
      setError(null);
      setBusy(picked.length);
      const done: UploadedBlob[] = [];
      try {
        for (const { file, path } of picked) {
          // SERIALLY, NOT `Promise.all`. A folder of four hundred files fired at once is four
          // hundred concurrent requests against the orchestrator and the object store behind it;
          // the progress count below is also only honest if they land one at a time.
          done.push(await upload(file, folder ? path : undefined));
          setBusy((n) => n - 1);
        }
      } catch (err: unknown) {
        // WHAT LANDED IS KEPT. A folder that failed on file 300 has 299 real refs, and throwing
        // them away would make the retry re-upload everything for one failure.
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(0);
      }
      if (done.length === 0) return;
      // THE NAME ALREADY CHOSEN WINS. Dropping a second batch into a folder field appends, and
      // re-deriving the name from the newest arrival would silently rename the whole folder to
      // whatever was dragged last.
      const name = folder ? folderName || done[0]?.path?.split('/')[0] || 'folder' : '';
      onChange(writeRef(folder ? [...(held ?? []), ...done] : done, folder, name));
    },
    [folder, folderName, held, onChange, upload]
  );

  const clear = (): void => {
    setError(null);
    onChange('');
  };

  // A VALUE THIS CONTROL CANNOT READ IS SHOWN, NOT SWALLOWED. The field is a JSON one underneath and
  // an operator may legitimately have typed or pasted a ref by hand; replacing it with an empty drop
  // zone would look like the form losing their work.
  if (held === null) {
    return (
      <div className="flex flex-col gap-1" data-testid={testId}>
        <code
          className="block truncate rounded border border-dashed border-border bg-muted px-1.5 py-1 font-mono text-[10.5px] text-muted-foreground"
          title={value}
          data-testid={`${testId}-opaque`}
        >
          {value}
        </code>
        <button
          type="button"
          className="self-start text-[10px] text-muted-foreground underline hover:text-foreground"
          onClick={clear}
          data-testid={`${testId}-replace`}
        >
          clear and drop a {kind} instead
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div
        role="button"
        tabIndex={0}
        aria-label={folder ? 'choose or drop a folder' : 'choose or drop a file'}
        data-testid={`${testId}-zone`}
        data-over={over ? 'true' : undefined}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed px-2 py-3 text-[11px] ${
          over
            ? 'border-primary bg-accent text-foreground'
            : 'border-border text-muted-foreground hover:border-muted-foreground/60'
        }`}
        onClick={() => picker.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            picker.current?.click();
          }
        }}
        onDragOver={(e) => {
          // BOTH, AND BOTH ARE REQUIRED. Without `preventDefault` on dragover the browser refuses
          // the drop outright and navigates to the file instead, which loses whatever was typed.
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void filesFromDrop(e.dataTransfer).then(take);
        }}
      >
        {busy > 0 ? (
          <>
            <Loader2 size={13} className="animate-spin" aria-hidden />
            <span data-testid={`${testId}-busy`}>uploading… {busy} left</span>
          </>
        ) : (
          <>
            <Upload size={13} aria-hidden />
            <span>
              drop a {kind} here, or <span className="underline">choose</span>
            </span>
          </>
        )}
      </div>

      <input
        ref={picker}
        type="file"
        className="hidden"
        data-testid={`${testId}-picker`}
        multiple={folder}
        // `webkitdirectory` IS THE ONLY WAY TO CHOOSE A DIRECTORY, and React does not know the
        // attribute, so it goes through the DOM-name escape hatch rather than as a prop.
        {...(folder ? ({ webkitdirectory: '' } as Record<string, string>) : {})}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).map((file) => ({
            file,
            // The picker reports the path inside the chosen directory here; a single-file picker
            // leaves it empty, which is exactly when it is not wanted.
            path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          }));
          // RESET, so choosing the same file twice fires. An `<input type=file>` does not emit
          // `change` for an identical selection, which reads as a control that stopped working.
          e.target.value = '';
          void take(picked);
        }}
      />

      {held.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid={`${testId}-held`}>
          {held.slice(0, 8).map((blob) => (
            <li
              key={`${blob.sha256}:${blob.path ?? blob.name}`}
              className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground"
            >
              {folder ? <FolderOpen size={11} aria-hidden /> : <FileIcon size={11} aria-hidden />}
              <span className="truncate text-foreground" title={blob.path ?? blob.name}>
                {blob.path ?? blob.name}
              </span>
              <span className="shrink-0">{sizeWords(blob.size)}</span>
              {/* THE SHA IS SHOWN, SHORT. It is the address the actor will dereference and the only
                  way to tell two uploads of the same filename apart — an operator re-running a job
                  a week later checks this, not the name. */}
              <span className="shrink-0 opacity-60" title={blob.sha256}>
                {blob.sha256.slice(0, 12)}
              </span>
            </li>
          ))}
          {held.length > 8 && (
            <li className="font-mono text-[10px] text-muted-foreground">
              +{held.length - 8} more
            </li>
          )}
        </ul>
      )}

      {held.length > 0 && (
        <button
          type="button"
          className="flex items-center gap-1 self-start text-[10px] text-muted-foreground hover:text-foreground"
          onClick={clear}
          data-testid={`${testId}-clear`}
        >
          <X size={10} /> clear
        </button>
      )}

      {error !== null && (
        <span className="text-[10px] text-destructive" data-testid={`${testId}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}
