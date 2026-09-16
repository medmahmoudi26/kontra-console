/**
 * THE METHOD'S SHAPE AS IT IS ON DISK RIGHT NOW, for every surface that draws a form.
 *
 * WHY THIS IS SHARED RATHER THAN LIVING IN ONE PANEL. It used to live inside `DevPane`, which is
 * the editor pane at `/dev`. The Actors page — the one an operator actually lands on — rendered the
 * same `MethodCall` from the CATALOG alone, which is what a worker published when it booted. So a
 * Method whose input type was annotated and saved, but whose Actor had never successfully served,
 * drew the "declares no input schema" notice and told the author to go and annotate the input type
 * they had already annotated. The file said `takes=Target` with two fields; the page said there was
 * no schema; and the sentence blamed the code for the system's empty catalog.
 *
 * MEASURED, on the install this was written against: GET /api/sources/actor/actor:hello:1ikb16f/schema
 * answered with `name: string` and `age: integer` while the Actors page for the same Actor drew the
 * empty-schema notice. The data was already correct and already served — that page simply never
 * asked for it. One hook, used by both, is the fix that keeps them from disagreeing again.
 *
 * THE CATALOG IS STILL THE FALLBACK, not the enemy: it is the honest answer for an Actor whose
 * folder is not registered here, and `disk` is null in exactly that case.
 */

import { useCallback, useEffect, useState } from 'react';

import { actorDiskSchemaStream, fetchActorDiskSchema, type DiskSchema } from '@kontra/console-core/run/api';

export interface DiskSchemaState {
  /** The derived schema, or null when it has not been read or would not derive. */
  disk: DiskSchema | null;
  /** Why it would not derive — a syntax error, a missing import — surfaced beside the form. */
  diskError: string;
}

/**
 * Read `folderId`'s schema from disk and keep it current.
 *
 * A FAILED DERIVATION DOES NOT CLEAR THE FORM. `disk` is left at its last good value and the reason
 * goes to `diskError`, because a form that vanishes on every keystroke that does not yet parse is
 * worse than a form that is briefly stale — the author is mid-edit and the half-typed state is not
 * an error they need the UI to react to.
 *
 * LIVE WITHOUT AN EDITOR ATTACHED. The `EventSource` is the server saying the folder changed;
 * before it existed, only the VS Code extension could make this instant, by hooking its own save
 * event and pushing a reload into the pane. That made "instant" a property of the pane rather than
 * of the runner, and it did not survive the move to a browser tab.
 */
export function useDiskSchema(folderId: string | undefined): DiskSchemaState {
  const [disk, setDisk] = useState<DiskSchema | null>(null);
  const [diskError, setDiskError] = useState('');

  const read = useCallback(async (): Promise<void> => {
    if (!folderId) return;
    try {
      setDisk(await fetchActorDiskSchema(folderId));
      setDiskError('');
    } catch (err) {
      setDiskError(err instanceof Error ? err.message : String(err));
    }
  }, [folderId]);

  useEffect(() => {
    void read();
  }, [read]);

  useEffect(() => {
    if (!folderId) return;
    const es = new EventSource(actorDiskSchemaStream(folderId));
    es.onmessage = () => void read();
    return () => es.close();
  }, [folderId, read]);

  // A DIFFERENT FOLDER MUST NOT SHOW THE PREVIOUS ONE'S FIELDS, even for the tick before the fetch
  // lands. Without this, opening a second Actor drew the first Actor's form — briefly, and
  // convincingly, which is the worst duration for a wrong answer.
  useEffect(() => {
    setDisk(null);
    setDiskError('');
  }, [folderId]);

  return { disk, diskError };
}

/**
 * The Method to render: the file's version when it derived, the catalog's when it did not.
 *
 * A SHALLOW MERGE, and the order is the point — `input` and `output` from disk win, while
 * everything the catalog knows and the file cannot (what a worker actually registered) survives.
 */
export function methodFromDisk<T extends { name: string }>(op: T | undefined, disk: DiskSchema | null): T | undefined {
  if (!op || !disk) return op;
  const fromDisk = disk.methods.find((m) => m.name === op.name);
  return fromDisk ? { ...op, ...fromDisk } : op;
}

/**
 * A short, stable signature of what a Method takes and emits — a REMOUNT TRIGGER, not a digest.
 *
 * WHY A KEY AND NOT A PROP. `MethodCall` seeds its field state from `op` in a `useState`
 * initialiser (MethodCall.tsx:94), which runs once per mount. Handing it a new `op` therefore
 * changes nothing on screen: the schema arrives from disk a moment after the panel opens, and the
 * form goes on showing the fields it was born with.
 *
 * MEASURED, and this was the last of the three bugs between a correct schema and a visible form:
 * the network log showed `GET /api/sources/actor/actor:hello:1ikb16f/schema` answering 200 with
 * `name` and `age`, while the panel beside it still read "declares no input schema". The data had
 * arrived and the component had simply never been rebuilt to look at it.
 */
export function shapeSig(op: { input?: unknown; output?: unknown } | undefined): string {
  const text = JSON.stringify([op?.input ?? null, op?.output ?? null]);
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
