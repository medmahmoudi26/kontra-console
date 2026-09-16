# 08 — Secrets and Settings

Status: done

Type: AFK

## Parent

`kontra/docs/adr/0048-...` · decision 6

## What to build

The two remaining unblocked Surfaces. Small, and one of them is the most sensitive thing the console
touches.

**A secret's value never comes back and the UI must not imply it could.** A read answers the name,
the versions and which is current — nothing else. There is no reveal, no masked field holding a real
value, no copy-to-clipboard of something the API never sent. A field that looks like it holds a
secret and holds a placeholder is worse than an empty one.

Settings is the console's own configuration. Anything it shows that is a credential follows the same
rule.

## Acceptance criteria

- [ ] A secret can be created and rotated; the list shows name, versions and current
- [ ] No surface renders a secret's value, and no control suggests one is retrievable
- [ ] Creating a secret with a name that already exists rotates it and says so, rather than
      silently replacing or silently failing
- [ ] Settings renders and persists the console's own configuration
- [ ] Both are usable at 390px with no horizontal overflow, per 03
- [ ] An e2e spec covers both, passing against React first

## Blocked by

- `06-catalog-and-navigation-between-bundles.md`

## Comments

**Done.** Both serve from the Svelte bundle. Five of seven surfaces are now Svelte; what remains in
React is exactly the three the checkpoint is about — Workflows (React Flow), Datasets (ag-grid),
Monitor (terminals).

**Nothing on the Secrets page suggests a value is retrievable.** No reveal, no masked field holding a
placeholder, no copy control. The value input is `type=password`, `autocomplete=off`, and is never
populated — it is write-only because the API has nothing to put in it. A masked field showing
`••••••••` that is not a secret is worse than an empty one: it teaches that the value is here and
recoverable, which is what stops somebody recording it where it actually is.

**A rotation says it rotated.** The API answers `rotated: true`; the UI says `rotated to version N`
rather than `saved`. Silently replacing hides a destructive act behind a create button.

**A disabled store is named as disabled**, not as an error — 503 on this route means the
installation has no secret store, which is a configuration, not a fault.

**Settings shows only facts the control plane already knows** — namespace, reachability, and which
bundle serves each surface. A settings page you can type into would be a second source for values
the appliance reads from `config.yaml` at boot.
