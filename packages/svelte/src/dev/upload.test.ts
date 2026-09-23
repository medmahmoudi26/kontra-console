/**
 * What a drop does, without a browser.
 *
 * The two claims worth pinning are the ones that fail SILENTLY in production: a folder read that
 * stops at its first page (every file present, most of them missing) and a partial failure that
 * throws away what already landed. Both look like success from the outside, which is why they are
 * tested here rather than left to the e2e suite.
 */
import { describe, expect, it, vi } from 'vitest';

import type { BlobRef } from './payload';
import { fieldValueOf, filesFrom, uploadAll, type Upload } from './upload';

function fileOf(name: string, path?: string): File {
  const f = new File(['x'], name);
  if (path !== undefined) Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

const refOf = (name: string): BlobRef => ({ name, sha256: 'deadbeef', size: 1 });

describe('uploadAll', () => {
  it('uploads in order and reports before each file, not after', async () => {
    const seen: Upload[] = [];
    const done = await uploadAll(
      [fileOf('a.txt'), fileOf('b.txt')],
      (u) => seen.push(u),
      async (f) => refOf(f.name)
    );
    expect(seen.map((u) => (u.state === 'uploading' ? `${u.done}/${u.total} ${u.name}` : u.state))).toEqual([
      '0/2 a.txt',
      '1/2 b.txt',
    ]);
    expect(done).toEqual({ state: 'done', refs: [refOf('a.txt'), refOf('b.txt')] });
  });

  it('keeps what landed when one file fails, and names the file', async () => {
    const done = await uploadAll(
      [fileOf('a.txt'), fileOf('big.bin'), fileOf('c.txt')],
      () => {},
      async (f) => {
        if (f.name === 'big.bin') throw new Error('HTTP 413');
        return refOf(f.name);
      }
    );
    expect(done.state).toBe('done');
    if (done.state !== 'done') return;
    // The nine-files-in-and-the-tenth-fails case: the ones already in the store stay.
    expect(done.refs).toEqual([refOf('a.txt')]);
    expect(done.error).toBe('big.bin: HTTP 413');
  });

  it('hands the relative path through, so a folder keeps its shape', async () => {
    const paths: (string | undefined)[] = [];
    await uploadAll([fileOf('1.txt', 'corpus/a/1.txt'), fileOf('loose.txt')], () => {}, async (f, p) => {
      paths.push(p);
      return refOf(f.name);
    });
    // Two files called `1.txt` under different directories collide inside the actor without this.
    expect(paths).toEqual(['corpus/a/1.txt', undefined]);
  });

  it('an empty drop is done, not uploading', async () => {
    const up = vi.fn();
    expect(await uploadAll([], up)).toEqual({ state: 'done', refs: [] });
    expect(up).not.toHaveBeenCalled();
  });
});

describe('fieldValueOf', () => {
  it('a file is one ref and a folder is a list, even for one file', () => {
    expect(fieldValueOf('file', [refOf('a')])).toEqual(refOf('a'));
    expect(fieldValueOf('folder', [refOf('a')])).toEqual({ files: [refOf('a')] });
    expect(fieldValueOf('file', [])).toBeUndefined();
  });
});

/** A `FileSystemDirectoryEntry` that answers in pages, the way Chromium's does. */
function dirEntry(name: string, children: FileSystemEntry[], page = 100): FileSystemEntry {
  let sent = 0;
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    createReader: () => ({
      readEntries: (ok: (e: FileSystemEntry[]) => void) => {
        const batch = children.slice(sent, sent + page);
        sent += batch.length;
        ok(batch);
      },
    }),
  } as unknown as FileSystemEntry;
}

function fileEntry(name: string, fullPath: string): FileSystemEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok: (f: File) => void) => ok(new File(['x'], name)),
  } as unknown as FileSystemEntry;
}

function transferOf(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((e) => ({ webkitGetAsEntry: () => e })),
    files,
  } as unknown as DataTransfer;
}

describe('filesFrom', () => {
  it('reads a directory past its first page', async () => {
    const kids = Array.from({ length: 240 }, (_, i) => fileEntry(`${i}.txt`, `/corpus/${i}.txt`));
    const got = await filesFrom(transferOf([dirEntry('corpus', kids)]));
    // 100 is the page size, and a single `readEntries` would have returned exactly that many —
    // which is a folder drop that looks like it worked and silently dropped 140 files.
    expect(got).toHaveLength(240);
  });

  it('stamps each file with its path in the tree', async () => {
    const got = await filesFrom(
      transferOf([dirEntry('corpus', [dirEntry('a', [fileEntry('1.txt', '/corpus/a/1.txt')])])])
    );
    expect(got.map((f) => (f as File & { webkitRelativePath: string }).webkitRelativePath)).toEqual([
      'corpus/a/1.txt',
    ]);
  });

  it('falls back to `files` where there are no entries to walk', async () => {
    const plain = new File(['x'], 'dropped.txt');
    expect(await filesFrom(transferOf([], [plain]))).toEqual([plain]);
  });
});
