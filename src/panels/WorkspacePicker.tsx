/**
 * Session-wide workspace picker in the nav rail.
 *
 * A workspace is a named child under the Compose parent mount. Switching changes which actors and
 * workflows the catalog discovers; Datasets and runs stay cluster-wide.
 */

import { useCallback, useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';

import {
  createWorkspace,
  fetchWorkspaces,
  useWorkspace,
  type WorkspaceList,
} from '../run/api';
import { useAppStore } from '../state/store';

export function WorkspacePicker({ collapsed }: { collapsed: boolean }): JSX.Element {
  const [list, setList] = useState<WorkspaceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  /* PUBLISHED, not kept private. The Actors grid filters its cards to the current workspace, and
     this component is the only thing that knows when that changes — switching is a click here. */
  const setWorkspace = useAppStore((s) => s.setWorkspace);

  const publish = useCallback(
    (got: WorkspaceList) => {
      setList(got);
      setWorkspace({ current: got.current, parent: got.parent });
    },
    [setWorkspace]
  );

  const reload = useCallback(() => {
    void fetchWorkspaces()
      .then((got) => {
        publish(got);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [publish]);

  useEffect(reload, [reload]);

  const onSelect = (next: string) => {
    if (!next || next === list?.current) return;
    setBusy(true);
    void useWorkspace(next)
      .then((got) => {
        publish(got);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  const onCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    void createWorkspace(trimmed, { seed: true })
      .then((got) => {
        publish(got);
        setName('');
        setCreating(false);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  if (collapsed) {
    return (
      <div
        className="border-b border-border px-1.5 py-2"
        data-testid="workspace-picker"
        title={list?.current ? `workspace: ${list.current}` : 'workspace'}
      >
        <span className="block truncate text-center font-mono text-[9px] text-muted-foreground">
          {list?.current ? list.current.slice(0, 3) : '—'}
        </span>
      </div>
    );
  }

  if (error && !list) {
    return (
      <div className="border-b border-border px-3 py-2" data-testid="workspace-picker">
        <p className="m-0 text-[10px] text-destructive" data-testid="workspace-error">
          {error}
        </p>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="border-b border-border px-3 py-2" data-testid="workspace-picker">
        <p className="m-0 text-[10px] text-muted-foreground">Loading workspaces…</p>
      </div>
    );
  }

  if (!list.parent) {
    return (
      <div className="border-b border-border px-3 py-2" data-testid="workspace-picker">
        <p className="m-0 text-[10px] leading-snug text-muted-foreground">
          No workspaces mount. On the host:
        </p>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-1.5 font-mono text-[9px] text-foreground">
          {list.mountHint || 'mkdir -p workspaces.kontra beside kontra/'}
        </pre>
      </div>
    );
  }

  const selectValue = list.names.includes(list.current) ? list.current : '';

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2" data-testid="workspace-picker">
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Workspace
        </span>
        <select
          className="rounded border border-border bg-background px-1.5 py-1 font-mono text-[11px] text-foreground"
          value={selectValue}
          disabled={busy || list.names.length === 0}
          onChange={(e) => onSelect(e.target.value)}
          data-testid="workspace-select"
        >
          {list.names.length === 0 ? (
            <option value="">(none)</option>
          ) : (
            <>
              {!selectValue && <option value="">(select)</option>}
              {list.names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </>
          )}
        </select>
      </label>

      {creating ? (
        <div className="flex gap-1">
          <input
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 font-mono text-[11px]"
            placeholder="name"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCreate();
            }}
            data-testid="workspace-create-input"
          />
          <button
            type="button"
            className="rounded bg-accent px-1.5 py-1 text-[10px] font-medium"
            disabled={busy || !name.trim()}
            onClick={onCreate}
            data-testid="workspace-create-confirm"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={busy}
          onClick={() => setCreating(true)}
          data-testid="workspace-create"
        >
          <FolderPlus size={12} />
          New workspace
        </button>
      )}

      {error && (
        <p className="m-0 text-[10px] text-destructive" data-testid="workspace-error">
          {error}
        </p>
      )}
    </div>
  );
}
