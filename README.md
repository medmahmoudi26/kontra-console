<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/kontra-logo-dark.svg">
  <img src=".github/assets/kontra-logo-light.svg" alt="kontra" width="238" height="48">
</picture>

# kontra-console

**The browser surface for [kontra](https://github.com/medmahmoudi26/kontra)** — several readings of a run, none of which substitutes for another.


> [!CAUTION]
> **The console is `0.x`, unstable, and in active development.** It is one half of
> [kontra](https://github.com/medmahmoudi26/kontra), which is itself not ready for production use by
> anyone but its authors — read that repository's disclaimer first. Surfaces are added, renamed and
> removed between minors: the Monitor was removed outright in `2ea4cff`. Nothing here is a stable
> API, including the routes this app calls.

| | |
|---|---|
| **Catalog** | what this install holds |
| **Workflows** | the thread: your workflows, their runs, and the Transcript of what each one did |
| **Runs** | one execution, laid out against time |
| **Actors** | what is deployed, at what version, and what each Method takes |
| **Datasets** | what came back, queryable while the Run is still open |
| **Logs** | what the control plane said |
| **Secrets** | names, never values |
| **Settings** | what this installation is — including **Infra**, every Machine and what is serving on it |

*The **Monitor** surface and the panels plane were removed in `2ea4cff`. A Machine's terminals are
no longer a surface; what is running where is a section of Settings.*

It is a **control plane, not a canvas.** kontra had a graph interpreter until v2; ADR 0023 §12 deleted it, and a **Run** became one execution of a workflow you wrote. Nothing here builds a program — it shows you the one that ran.

## Running it

```bash
pnpm install
pnpm dev            # against a control plane on http://localhost:8088
```

You need a control plane to look at. `kontra up` gives you one — see [kontra](https://github.com/medmahmoudi26/kontra).

```bash
pnpm build          # typecheck + the SPA
pnpm test           # vitest — 2,147 tests, no checkout of kontra needed
pnpm typecheck:e2e  # the Playwright harness — needs kontra as a sibling (below)
pnpm test:e2e       # e2e, needs a live control plane
```

### The one dependency on kontra

```json
"@kontra/core": "link:../kontra/shared/core"
```

`@kontra/core` is the shared kernel — the contract types, the Transcript reader, the Warden's
vocabulary, the queue-name derivations. The console **imports** it rather than restating it, so a
rename on the server side is a red build here rather than a panel that quietly renders nothing.

Until it is published to npm this is a `link:` to a sibling checkout, so the layout is:

```
parent/
  kontra/            github.com/medmahmoudi26/kontra
  kontra-console/    this repository
```

Build it once (`pnpm --filter @kontra/core build` inside kontra) and it is live — `link:` is a
symlink, not a copy, so an edit there is visible here without reinstalling. When the package is
published this line becomes an ordinary version range and the sibling requirement goes away.

**`pnpm test` and `pnpm build` do not need kontra checked out** — only `@kontra/core`'s built
output, which the link provides. The exception is `e2e/`, which constructs a real `PanelServer`
from the orchestrator's own source; it has its own `tsconfig.e2e.json` saying so.

## How it reaches the control plane

**23 API paths**, all under `/api`, served by the orchestrator. That is the contract between this repository and kontra, and it is larger than it looks — every route the console calls is one somebody must not rename without changing both sides.

There is **no generated client**: `src/run/api.ts` and its neighbours hand-write the response shapes. Some of what crosses that seam *is* shared — the retention window, the Dataset lifecycle union, the secret-name rule all come from `@kontra/core` — but the routes and their payloads do not. Worth knowing before you change a route on the other side, because nothing will fail at build time; the console will simply render an empty panel where the data used to be.

## How it ships

The console is not compiled into the kontra binary. It is a **content-addressed artifact**: `pnpm build` produces a `dist/`, that becomes a tar.gz, and the appliance hydrates it by digest —

```go
Artifact{Name: "spa", Kind: KindTarGz, Digest: digest}   // cli/appliance/bundle/hydrate.go
```

— which is the same mechanism a **Bundle** uses. So this repository publishes an artifact and the release pins it, rather than kontra needing this source tree to build.

> [!WARNING]
> **`VITE_KONTRA_EXPLORE_TOKEN` is baked into the bundle at build time.** A token inside a browser bundle is only as private as the page serving it — it is not a secret from anyone who loads the console. This is a known weakness, not a design: see kontra's [Security Model](https://github.com/medmahmoudi26/kontra/wiki/Security-Model).

## Design

`.design-sync/` upstream carries the design-system conventions this follows. Two rules that are load-bearing rather than stylistic:

- **A mock's charts are `Math.sin`.** Design previews carry fake data so the shape can be judged; implementing one as-is ships a chart that is not measuring anything.
- **A blank panel is a bug, not an empty state.** The Monitor's whole argument is that a Machine whose Worker is running perfectly must never draw as one with no session — so "nothing to show" and "we could not ask" have to render differently.

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE).
