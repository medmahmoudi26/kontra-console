# 08 — Secrets and Settings

Status: ready-for-agent

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
