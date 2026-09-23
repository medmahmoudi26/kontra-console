import { describe, expect, it } from 'vitest';

import { readWorkspaces } from './workspaces';

describe('readWorkspaces', () => {
  it('survives an answer with nothing in it', () => {
    // MEASURED: the browser suite\'s fixture answers `{}` for routes it does not model, and reading
    // `.names.length` off that threw inside the shell — which is a blank console, not a missing
    // picker. An older control plane answers the same way.
    expect(readWorkspaces({})).toEqual({
      parent: '',
      current: '',
      names: [],
      currentPath: '',
      mountHint: '',
    });
    expect(readWorkspaces(undefined).names).toEqual([]);
    expect(readWorkspaces(null).names).toEqual([]);
    expect(readWorkspaces('not an object').names).toEqual([]);
  });

  it('keeps a real answer intact', () => {
    expect(
      readWorkspaces({
        parent: '/w',
        current: 'default',
        names: ['default', 'other'],
        currentPath: '/w/default',
        mountHint: 'mkdir -p workspaces',
      })
    ).toEqual({
      parent: '/w',
      current: 'default',
      names: ['default', 'other'],
      currentPath: '/w/default',
      mountHint: 'mkdir -p workspaces',
    });
  });

  it('drops a name that is not a name', () => {
    // A blank option in the picker switches the workspace to nothing when chosen.
    expect(readWorkspaces({ names: ['a', 3, null, 'b'] }).names).toEqual(['a', 'b']);
  });
});
