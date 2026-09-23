# Runs — a Surface for the record of a run

**Status:** design, ready to build · **Repo:** `/root/oss/kontra-console` (+ `/root/oss/kontra` for the two server/runtime pieces)

---

## 1. Decision

Runs becomes a declared Surface addressed at `/runs` and `/runs/:runId`, and a run's page is one thing: **the input form it was started with, prefilled and read-only, above the typed output it produced** — a snapshot, gated on both status dimensions so it never draws an empty table over a run that wrote nothing. The one verb this Surface owns is **replay**, wired to `internals/replay.py`: the recorded Temporal history re-executed against the workflow code on disk, with every activity result fed from the record — a kontra Method *is* an activity, so replay sends **zero packets**. Re-running is a different thing with a different blast radius, so **the Runs Surface never starts a run**: `Re-dispatch…` hands a prefilled, drift-checked input to the existing Launch path in Workflows, behind a confirmation that names the traffic, and that handoff inherits every guardrail the start path already has. Output columns, their order, their tooltips and their failure semantics are read from the operator's runtime schemas — nothing in this design knows what `desync` or `canary` is. Note for accuracy: `DECLARED` in `packages/core/src/state/surfaces.ts` already carries **eight** ids (`logs` shipped after the brief was written), so Runs is its ninth entry.

---

## 2. The Runs Surface

### 2.1 Declaration (`packages/core/src/state/surfaces.ts`)

Add to `DECLARED`, immediately **after `workflows`** — you start work in Workflows and read the record in Runs:

```ts
{
  id: 'runs',
  label: 'Runs',
  hint: 'every run this control plane has seen — each one as the input it was started with and the output it produced',
},
```

Then, in the same file:

- **Delete `runs` from `RETIRED`.** Leave `scratch`. `/runs/<id>` stops being a redirect and becomes the live address it always meant — the id survives the move a second time, which is the property `RETIRED` existed to protect.
- **Rewrite the header prose.** The file header currently says *"Runs is retired… a run is reached through the workflow that produced it"*, and that paragraph is the authority the next reader will relitigate the decision from. Replace it with why Runs came back: a run has a record (input + output) that outlives the thread it was started in, and the workflow-scoped strip is the *entry*, not the *home*. `address.ts`'s header carries the same retired claim ("A RUN IS NO LONGER A SURFACE") — amend it too.
- `SPA_SEGMENTS` is total by construction and its *contents are unchanged* (`runs` moves from the retired half to the declared half). **Do not touch the server's copy in `/root/oss/kontra/control/orchestrator/src/server.ts`** — `runs` must stay in `SPA_SURFACES` or a cold load of `/runs/sweep-v1.2` 404s on the dot. `spaFallback.test.ts` pins the pair.
- `packages/svelte/src/lib/surfaces.ts` — add `{ id: 'runs', label: 'Runs' }` in the same position; `surfaces.test.ts` pins this list against the server's.

### 2.2 Address (`packages/core/src/state/address.ts`)

```ts
| { view: 'runs'; run: string | null }
```

- `AddressedState` gains **`runsRun: string | null`** — *not* a reuse of `runId`. `runId` is the Workflows surface's selection, and this file's own rule is that each address writes its own surface's fields and nothing else; sharing the field would make opening `/runs/x` silently re-select a run on a page the operator never left.
- `addressOf`: `case 'runs': return { view: 'runs', run: s.runsRun }`.
- `stateFor`: `case 'runs': return { view: 'runs', runsRun: address.run }`.
- `formatAddress`: `PATHS.runs` or `${PATHS.runs}/${encodeURIComponent(run)}`. No query — a run has no pane selection of its own; the Monitor pane for a run stays a Workflows concern.
- `parseAddress`: `/runs` → `{ run: null }`; `/runs/<id>` → `{ run: id }`; `/runs/a/b` → `null` (a third segment was never a URL this app could mean). Because `RETIRED.runs` is gone, `App.svelte`'s redirect branch (`if (RETIRED[first] !== undefined)`) no longer fires for it — no change needed there beyond the loader.
- `packages/svelte/src/App.svelte` `LOADERS`: `runs: () => import('./runs/Runs.svelte')`.
- `CONTEXT.md` §Surface says "One of the seven things the console is" and lists seven. Update the sentence and the list (it is nine with `logs`).

### 2.3 What moves, what stays, what is shared

| | |
|---|---|
| **Moves to Runs** | The **global** run list (every run, every workflow, filterable) and the **after-the-fact run page**: prefilled input, typed output, health, replay. Workflows' collapsible "runs of this workflow" list keeps only its scoped strip + streak (`streakOf`, `SHOWN_RUNS`). |
| **Stays in Workflows** | `Launch.svelte` — **the only path that calls `startRun`** — source/serve/pollers, the design canvas, the asks, and the **live** watch of the run you just started (`onstarted` → `RunStream`, `Timeline`, `LogsRail` in place). Pressing Run does not leave the page; that was the reason the old global Runs surface was retired and it stays true. |
| **Shared, not duplicated** | `packages/svelte/src/runs/` becomes the home of run components — the precedent already exists (`Workflows.svelte` imports `../runs/RunStream.svelte`). Move `Timeline.svelte`, `LogsRail.svelte`, `Transcript.svelte`, `RunTail.svelte` there in step 3 and import from both sides. Core is untouched and read by both: `run/api.ts`, `run/runState.ts`, `panels/runDatasets.ts`, `panels/runStats.ts`, `datasets/preview.ts`. |

A run that is **still executing** opened at `/runs/<id>` renders the snapshot it can (input is always available; output is partial) with a banner — *"this run has not finished; the live view is on its workflow"* — linking to `/workflows/<w>/<id>`. Runs is the record; Workflows is the theatre.

### 2.4 Narrow-first layout (390px is the design width)

- **List**: one row per run — id (mono, elides from the left), workflow/type, the two dimension words from `executionOf` / `materializationOf` side by side, relative time. No horizontal scroll; the table lives in an `overflow-x:auto` container per the `overflow.mjs` guard.
- **Detail at panel width replaces the list** (one column, back link in the header), stacked: *Snapshot header → Input → Output → Health → Replay → Re-dispatch (last, visually separated)*.
- **≥900px earns** the list as a left rail beside the detail. Wide adds a column; narrow never loses one.

---

## 3. The snapshot

### 3.1 The prefilled input — and the honest part

**The run's input is not recorded anywhere the console can read today.** Verified, not assumed:

- `RunRow` / `RunDetail` (`packages/core/src/run/api.ts:61,112`) carry no input field, and `/api/runs/:runId` returns `runs.read(runId)` — the two status dimensions and the ledger records, nothing else.
- The history reducer **never decodes a payload** by design (`/root/oss/kontra/shared/core/src/history.ts` — "PAYLOADS ARE NEVER DECODED", ADR 0007 claim-check fan-out).
- The archive (`historyArchive.ts`) stores *the reducer's output*, so it is payload-free too: after Temporal's 24h retention the input is simply gone.

So the input has to be **snapshotted at start**, which is exactly the pattern ADR 0025 and `data/runWorkflows.ts` already establish ("what must outlive Temporal's retention is snapshotted into a durable record at the moment it is known"). Three readers, in order:

| Order | Source | Where |
|---|---|---|
| 1 | **`RunInputStore`** — the input as posted, keyed by `runId`, written by **both** start paths, exactly as `stampRunWorkflow` is (`workflowControl.ts:897`): `POST /api/runs` stamps inline; `kontra workflow start` stamps via a new `PUT /api/runs/:runId/input` beside the existing `PUT /api/runs/:runId/workflow`. **Best-effort and swallowing** — a failed snapshot must never report a started run as a failed start. | new `control/orchestrator/src/data/runInputs.ts` |
| 2 | **Recovery** for runs started before this store existed: decode the `WorkflowExecutionStarted` input **once** through the orchestrator's own converter (`src/codec/dataConverter.ts` + `claimCheck.ts`). This is a deliberate, bounded exception to the no-payload rule — one payload per run page, not the thousands a history render would fan out to — and the route's doc comment must say so and state the bound. | new `control/orchestrator/src/routes/runInput.ts` |
| 3 | **Nothing.** `{ source: 'unavailable', reason: 'retention' \| 'not-recorded' \| 'undecodable' }` → the form still renders **from the current descriptor**, every field empty, with the sentence *"this run's input was not recorded — these are the fields the workflow declares today, not what it was started with."* Never a fabricated default. **Re-dispatch is refused in this state** (§5). | — |

Route: `GET /api/runs/{runId}/input` → `{ runId, source, input?, truncated?, reason?, workflow?: {name,version}, type }`. **Fail-closed** on `RUN_TOKEN_VARS` (an input names hosts, scopes and endpoints), therefore read with `fetch` + bearer via `session.ts` — never `EventSource`. Cap the stored document (64 KB) with an explicit `truncated` flag rather than a silent tail; `File` fields are already refs (`{name, sha256, size}`, `svelte/src/dev/payload.ts`) so no bytes are ever stored. Regenerate `packages/core/src/run/routes.gen.ts` (`node scripts/generate-routes.mjs`) — `routes.gen.test.ts` fails if you forget.

**Which schema draws the form.** `RunWorkflowStore` (`data/runWorkflows.ts`) already maps `runId → {workflow, version}` — the manifest name, which is what `fetchWorkflows()` descriptors are keyed by. Fallback: match `RunDetail.type` (the `@workflow.defn` class) against the descriptor list. If neither resolves, render the recorded input as raw JSON via the `kind:'json'` path of `panels/workflowInput.ts` carrying `why:'undeclared'` — never a blank card.

**Assembling values, drift-honestly.** New pure module `packages/core/src/run/prefill.ts`:

```ts
prefillValues(fields: FieldNode[], recorded: unknown):
  { values: FieldValues; extras: [string, unknown][]; missing: string[] }
```

- `values` — recorded values stringified per declared type, keyed by path, the exact shape `Field.svelte` + `formFields.ts` already consume.
- `extras` — recorded keys the current schema no longer declares (the code moved on since the run). Rendered as a labelled raw tail, **never dropped**: same rule as `orderedFields`' "a worker may be a version ahead of the catalog".
- `missing` — declared fields with no recorded value, rendered empty and marked *"not in the recorded input"*.

`RunInput.svelte` renders `Field.svelte` in a disabled state, so the read-only snapshot and the live launcher are literally the same controls and cannot disagree about what a `Literal` or a `bool` looks like. Below it, the copyable start line from `inputArg(draft)` (`panels/workflowInput.ts`), which already prints the coerced values.

### 3.2 The typed output

`RunOutput.svelte`, mirroring the `RunStream.svelte` pattern one level up:

1. Datasets for this run: `datasetsOf(detail.materializationRecords, catalog)` (`run/runState.ts`) joined with `runDatasets()` attribution (`panels/runDatasets.ts` — `sole` / `among` / `owner`). A record is keyed by actor, and an output Dataset is addressed by the actor that produced it, so **the actor is the section**.
2. Schema per section: the actor's **output** schema from `/api/actors` → `CatalogActor.operations[].output`, read with `readSchema` / `schemaTree` (`panels/workflowContract.ts`) — the same reading the Actors page uses for Method ports. Where an actor declares several Methods, pick the one whose declared property set best covers the preview's columns and say which; if ambiguous, say *"several Methods of this actor declare an output; columns are the table's own"*.
3. Rows: `fetchPreview({ dataset, kind, version, dt, limit })` (`datasets/preview.ts`) — server-rendered, positional rows, `truncated` drawn, never a silent cap.
4. Columns: new pure `packages/core/src/run/outputColumns.ts` → `orderColumns(names, schema)`, returning `{ name, description, declared }[]` in **declaration order, undeclared columns appended alphabetically and marked**. This is `orderedFields` + `describeField` (`run/progress.ts:227,264`) lifted one level; factor the shared "declared first, then the rest, never drop" rule so the stream pane and the output table cannot drift.
5. Render in `DataTable.svelte` with `columns` + `cell` + `textOf` (per-column filter) + **`cellValue`** → `CellInspector`. **No `onpick`** — the component's own rule is that a table is row-navigable *or* cell-inspectable, never both.
6. `among` partitions (a Dataset several runs wrote into) say so and link out to `/datasets/<name>?run=<id>`, which the address parser already supports — the preview route has no run filter, so claiming these rows are this run's would be the ratio-across-two-moments lie `runDatasetCounts` already refuses.

### 3.3 When the two dimensions disagree

Two words, side by side, each carrying `Dimension.title` verbatim from `runState.ts`. There is no combined verdict here either.

| execution | materialization | What the snapshot shows |
|---|---|---|
| `running` | any | Banner: *not final*. Output sections render what exists, labelled **partial**; link to the live view. |
| `completed` | `unknown` | **No table.** *"The ledger could not be read. This is NOT a claim that the run wrote nothing."* (the `materializationOf` sentence). Retry affordance, not an empty grid. |
| `completed` | `unrecorded` | **No table.** *"No writer recorded a Dataset for this run"* — plus the `runStats` distinction between `unrecorded` and `0`. A caller that published a Dataset itself lands here legitimately, so offer the Datasets link scoped by `?run=`. |
| `completed` | `complete`, rows 0 | Table with a header and zero rows + *"a successful empty result"*. Zero is an answer. |
| `completed` | `failed` | Sections render; the failed record's `error` is printed at section level, above the rows. |
| `failed` / `cancelled` | rows > 0 | *"It wrote N rows before it ended — this output is partial."* Both words shown; neither is softened. |

---

## 4. Safe replay

### 4.1 Wiring

New route `POST /api/runs/{runId}/replay` (`control/orchestrator/src/routes/replay.ts`), which shells **exactly what `kontra workflow replay` shells** (`cli/workflowreplay.go:117`):

```
python -m internals.replaycmd replay <abs workflow file> --workflow-id <runId> --json
```

with `PYTHONPATH` per `replayPython()`. The workflow file is resolved `runId → RunWorkflowStore → registered source folder (sources.ts)`. Exit codes map straight through and the body is `ReplayResult.as_json()` — `{ outcome, runId, workflowType, detail }`:

| exit | `outcome` | Meaning |
|---|---|---|
| 0 | `ok` | The history replays cleanly against the code on disk. |
| 1 | `nondeterministic` | A fact about **the workflow code**: an execution already in flight would break. |
| 2 | `unrunnable` | A fact about **this setup** — missing codec, sandbox, import, no history. Says nothing about the workflow. |

Synchronous with a server-side timeout (120s), a timeout mapping to `unrunnable` with the reason. Fail-closed on the run token → `fetch` + bearer (it is a POST, so `EventSource` was never on the table; the constraint still bites on any streaming variant).

### 4.2 What it reconstructs, and the guarantee

It executes the **caller workflow's decisions only** — batch splitting, chaining, branching, early exit — and feeds every activity result from the recorded history. A kontra actor Method **is** an activity, and Temporal's replayer does not run activity code, so **no probe is sent, no poison frame is written, nothing leaves the box**. `replay.py` builds the Replayer with `casstore.data_converter()` (the ClaimCheck codec) and the same `SandboxedWorkflowRunner` passthrough list the worker serves under — the two things that must match or the answer is a lie.

### 4.3 How the UI makes that unmistakable

- Its own card, titled **"Replay — reconstruction, no traffic"**, with the guarantee as **permanent body text**, not a tooltip: *"Replay re-runs the workflow's decisions against this run's recorded history. Actor Methods are activities and activity code is not executed — their results come from the record. Nothing is sent."*
- Button label: **`Replay history`**. Never "run", never "re-run", never "retry".
- Three results, three shapes, never collapsed:
  - `ok` — quiet/green: *"the history replays cleanly against this code"*, with the file replayed and the classes named.
  - `nondeterministic` — `--bad`: *"the code on disk no longer agrees with what this run did — an execution already in flight would break"* + `detail` (which carries Temporal's cause chain via `_with_cause`).
  - `unrunnable` — `--warn`, **and explicitly not a verdict**: *"the replay could not be performed — this is a setup problem, not a finding about your workflow"* (reuse the CLI's wording at `cli/workflowreplay.go:135–142`).
- Replay is the **only** verb on this Surface that touches the run.

---

## 5. Guarded re-run

### 5.1 It does not live here

**`src/runs/**` never imports `startRun`.** The affordance is `Re-dispatch…`, which after confirmation navigates to `/workflows/<folder>?prefill=<runId>`; `Launch.svelte` reads `?prefill`, fetches `GET /api/runs/:runId/input`, seeds its form, and the operator must press its existing **Run**. Every start guardrail already lives there and duplicating them would create a second start path — which is precisely how one of them ends up missing.

### 5.2 Separation

Bottom of the page, after Replay, in a `--bad`-toned card titled **"Re-dispatch — this sends live traffic"**. Different verb, different colour, different position; the Replay card's permanent line and this card's permanent line are the pair a reader compares. The button opens a confirmation; it never posts.

### 5.3 Everything it inherits

1. **The same `POST /api/runs`** — `checkOptionalBearer(RUN_TOKEN_VARS)`, plus the `run.start` **audit line on both outcomes** including refusals (`routes/runs.ts:107`). Exposure posture (`fetchExposure`) is already shown on Launch.
2. **The queue is not a field** (GitHub #15): derived from the folder server-side; the server refuses if no worker serves that folder's current code; Launch shows pollers and a Serve button.
3. **Workflow-level refusals stay the workflow's, and the console must never "help" around them.** `severity` refuses without **both** `host` and `variant` because poisoning a shared front-end can hand a wrong response to a stranger (`workspaces/bugbounty/workflows/severity/workflow.py`). Concretely: the prefill is **never pruned** — a value on an "optional" field is carried, and there is no "run the whole program" affordance anywhere in this flow.
4. **Actor-side invariants are not exposed at all.** The `?cb=${random}` cachebuster (`actors/desync/frame.go:298`), the incomplete-prefix corpus that never completes the smuggled request, and the per-host `rate_ms` pacer with one shared scanner per session (`actors/desync/main.go:60`, `frame.go:12`) are actor constants. The console offers no override, no "faster", no concurrency knob.
5. **Drift is caught by diff, not by meaning.** Every field the operator edits away from the recorded value is listed **old → new** in the confirmation. `rate_ms 400 → 50` and `scope scope_h1paid → (blank)` become visible without the console modelling pacing or scope — which is the only version of this guard that also works for an actor nobody has written yet.
6. **Scope re-authorisation.** The confirmation requires (a) an explicit checkbox — *"I am authorised to send this traffic to these targets, now"* — and (b) typing the workflow name to enable the button. Required-field emptiness is Launch's existing `missing()` check (`svelte/src/dev/payload.ts:66`).
7. **Refusals, hard:** no recorded input → **no re-dispatch** (you cannot re-send what you cannot see); folder unregistered or unserved → no; a recorded key the schema no longer declares, or a newly required field → disabled until each is resolved; the run is still executing → disabled, with *"this run has not finished; re-dispatching now doubles the traffic"*.
8. **The dry run is the command, not a fake execution.** The confirmation prints the exact `kontra workflow start <folder> --input '<json>'` line from `inputArg()` — already built, already showing coerced values, and copyable so an operator can run it out of band under their own eyes.

**Blast-radius sentence** (values quoted verbatim from the input; counts from the run's own record — no target taxonomy is invented):

> Re-dispatching **severity** executes its Methods for real. The recorded run made **12 dispatches to `desync/reach`** and wrote **27 rows** to `reach_verdicts`. This sends live traffic to **`pay.8x8.com`** (`variant: around-colon-09-preserve`, `rounds: 120`, `rate_ms: 400`) again. **Replay does not.**

---

## 6. Error / health surface

### 6.1 The contract (where it is defined)

**`x-kontra-health` on an output-schema *property*** — a JSON-Schema extension keyword, written by the actor author in their own schema, carried untouched through the catalog and read from `CatalogActor.operations[].output`. Four values:

| value | meaning |
|---|---|
| `failure` | truthy / non-empty ⇒ **this row failed** (`erratic`, `voided`) |
| `ok` | truthy ⇒ healthy, falsy ⇒ failed (`canary.ok`) |
| `reason` | the text that explains a failure (`error`, `void_reason`) |
| `note` | a qualification shown but never counted (`elided`) |

The person who owns the meaning declares it. That is what makes this work for `desync`, for `canary`, and for an actor nobody has written yet.

### 6.2 The fallback heuristic

`packages/core/src/run/outcome.ts`, used **only** when no property in the schema is annotated, and **always labelled "inferred, not declared"** on screen:

- `boolean` named exactly `ok` / `success` / `passed` → `ok`
- `boolean` named exactly `error` / `failed` / `erratic` / `voided` / `invalid` → `failure`
- `string` named exactly `error` / `failure` / `reason` / `void_reason` → `failure` + `reason` when non-empty
- nothing matches → **"this output declares no health field"**, and the surface counts rows only.

Exact names, never substrings; no actor name ever enters this module. Its signature is `project(schema, columns, rows) → HealthProjection` — it cannot be given an actor to special-case. That is the `program`-hardcoding regression written as a type.

```ts
interface HealthProjection {
  declared: boolean;              // annotation present, or inferred
  rows: number; failures: number;
  reasons: { text: string; count: number }[];
  notes: { column: string; count: number }[];
}
```

### 6.3 Presentation

- **Narrow-first summary**: one line per Dataset — `desync · 27 rows · 4 failed · "connection reset during window"` — with **severity leading** (a Dataset with failures sorts first, the rule `panels/health.ts` already states). An inferred projection carries a muted `inferred` marker.
- **Drill-in**: tapping a line filters that section's `DataTable` on the health column using the filter row `textOf` already provides, and `CellInspector` opens the whole value (`void_reason`, `elided`).
- It sits **beside** the two status dimensions as a **third reading of a third authority (the rows)** and is never rolled into them — a run can be `completed` + `complete` with 4 failed rows, and all three facts are true at once.

---

## 7. Component / file plan

| File | New / Modified | Responsibility |
|---|---|---|
| `packages/core/src/state/surfaces.ts` | modified | Declare `runs`; remove it from `RETIRED`; rewrite the retired-Runs prose. |
| `packages/core/src/state/address.ts` | modified | `runs` Address arm, `runsRun` on `AddressedState`, parse/format/round-trip. |
| `packages/core/src/run/prefill.ts` | **new** | `prefillValues(fields, recorded)` → values / extras / missing. Pure, framework-free. |
| `packages/core/src/run/outputColumns.ts` | **new** | `orderColumns(names, schema)` — declared order, descriptions, undeclared appended and marked. |
| `packages/core/src/run/outcome.ts` | **new** | `x-kontra-health` projection + the inferred fallback. Takes a schema, never a name. |
| `packages/core/src/run/api.ts` | modified | `fetchRunInput(runId)`, `replayRun(runId)`; types `RunInput`, `ReplayResult`. |
| `packages/core/src/run/routes.gen.ts` | regenerated | New operation ids for `/runs/{runId}/input` and `/runs/{runId}/replay`. |
| `packages/svelte/src/lib/surfaces.ts` | modified | Nav entry `Runs`, after `Workflows`. |
| `packages/svelte/src/App.svelte` | modified | `runs` loader. |
| `packages/svelte/src/runs/Runs.svelte` | **new** | Surface: list ↔ detail, narrow-first; reads the address. |
| `packages/svelte/src/runs/RunList.svelte` | **new** | Rows with both dimension words; filter by workflow / status. |
| `packages/svelte/src/runs/RunSnapshot.svelte` | **new** | The page: header + Input + Output + Health + Replay + Re-dispatch. |
| `packages/svelte/src/runs/RunInput.svelte` | **new** | Prefilled, disabled `Field.svelte` form + extras tail + start-command line. |
| `packages/svelte/src/runs/RunOutput.svelte` | **new** | Per-Dataset typed sections, dimension-gated, `DataTable` + `CellInspector`. |
| `packages/svelte/src/runs/RunHealth.svelte` | **new** | Health summary + drill-in filter. |
| `packages/svelte/src/runs/ReplayCard.svelte` | **new** | The replay verb, its guarantee text, the three outcomes. |
| `packages/svelte/src/runs/RedispatchCard.svelte` | **new** | Confirmation, diff, blast-radius sentence, handoff to `/workflows/<f>?prefill=`. |
| `packages/svelte/src/workflows/Launch.svelte` | modified | Read `?prefill=<runId>`, seed the form, require the existing Run press. |
| `packages/svelte/src/workflows/Workflows.svelte` | modified | Keep the scoped strip; "open in Runs" once terminal; drop the global-list pretence. |
| `packages/svelte/scripts/no-start-from-runs.mjs` | **new guard** | Fails the build if anything under `src/runs/**` imports `startRun` or posts `/api/runs`. |
| `control/orchestrator/src/data/runInputs.ts` | **new (kontra)** | Durable `runId → input` snapshot, two backends, size cap, `truncated`. |
| `control/orchestrator/src/routes/runInput.ts` | **new (kontra)** | `GET/PUT /api/runs/:runId/input`; store → Temporal single-payload decode → `unavailable`. |
| `control/orchestrator/src/routes/replay.ts` | **new (kontra)** | `POST /api/runs/:runId/replay`; exit 0/1/2 → the three outcomes. |
| `control/orchestrator/src/workflowControl.ts` | modified (kontra) | Stamp the input beside `stampRunWorkflow`, same swallow-on-failure rule. |
| `CONTEXT.md` (console) | modified | §Surface: the list and the count. |

---

## 8. Watch-outs

| Gotcha | Guard |
|---|---|
| **Execution and materialization disagree.** A `completed` run with no queryable output rendered as an empty table is the exact lie ADR 0017 exists to stop. | Never derive a single verdict. Render both `Dimension` words with `runState.ts`'s own `title` sentences, and branch the output body on the §3.3 table. A vitest per row of that table; an e2e for the `completed` + `unrecorded` case asserting **no table element exists**. |
| **`EventSource` cannot set a header.** Every fail-closed route (input, replay, the runs stream) 401s and the pane looks like a backend fault — this already happened once (`RunStream.svelte` header). | `fetch` + bearer via `session.ts` (which wraps `window.fetch`), and `readFrames` from `run/logstream.ts` for anything streamed. One SSE parser, no second one. |
| **Hardcoded fields.** The `program`-hardcoding regression drew one workspace correctly and every other one wrongly. | `outputColumns.ts` and `outcome.ts` take `(schema, …)` and cannot be handed an actor name. Test both against a **fabricated** actor + schema fixture, asserting declared order, tooltips and undeclared-column append. |
| **Undeclared vs empty output schema.** `dict` derives `{"type":"object","additionalProperties":true}` — "anything fits" — and drawing it as an empty field table says the opposite. | `readSchema`'s three answers and `sayNothing()` (`panels/workflowContract.ts`). No declared shape ⇒ draw the preview's own columns alphabetically and say **"no declared shape"** (the `RunStream` precedent); never refuse to draw. |
| **`unrunnable` read as `nondeterministic`.** Sends someone to rewrite a workflow because a codec was missing. | Distinct tone, distinct sentence, and the words *"this is a setup problem, not a finding about your workflow"* on exit 2. Pin the exit-code → outcome mapping in a route test; `internals/test_replay.py` already pins the Python side. |
| **Re-run mistaken for replay.** The whole safety case. | Separate card, separate tone, separate verb, permanent guarantee text on Replay and permanent warning on Re-dispatch; the Runs bundle mechanically cannot start a run (`no-start-from-runs.mjs`); an e2e asserts **no `POST /api/runs` is issued** when Replay is pressed. |
| **Input drift.** A run recorded against code that has since changed; a prefill that silently drops a key re-dispatches a *different* attack. | `prefillValues` returns `extras` and `missing` and the UI shows both; re-dispatch stays disabled until each is resolved. Never prune to fit the current schema. |
| **Run ids carry dots** (`sweep-v1.2`, per `server.ts`). | The server matches on the **first** segment and `runs` must remain in its `SPA_SURFACES` list when it leaves `RETIRED`. `spaFallback.test.ts` pins it. |
| **`runId` reused across surfaces.** A Runs address silently re-selecting the Workflows surface's run. | Separate `runsRun` field; `address.test.ts` asserts that landing on `/runs/x` leaves `runId` untouched. |
| **Polling.** `no-polling.mjs` will fail a `setInterval` list refresh. | The list is driven by the existing run stream (`followRun` / `run/logstream.ts`); the only legal interval is a wall-clock ticker for durations, exactly as `RunStream.svelte` justifies. |

---

## 9. Sequenced build

Each step is shippable and green under `pnpm test` (core guard + core vitest + svelte typecheck + svelte vitest + build + svelte guards) and `pnpm test:e2e`.

### Step 1 — The Surface exists and lists runs *(smallest)*

`surfaces.ts` (+ header prose), `lib/surfaces.ts`, `address.ts`, `App.svelte` loader, `Runs.svelte` + `RunList.svelte` over the existing `GET /api/runs`, detail header only (id, workflow, both dimension words, duration) with links out to the existing Workflows run view.

**Tests that keep it honest**
- `address.test.ts`: `/runs`, `/runs/<id>`, `/runs/<id with dot>` round-trip through `formatAddress`; `/runs/a/b` → `null`; `/runs/<id>` **no longer redirects**; landing on a Runs address does not write `runId`.
- `surfaces.test.ts`: the nav list still equals the server's `SPA_SURFACES`; `SPA_SEGMENTS` still contains `runs` and `scratch`.
- e2e `runs.spec.ts`: `nav-runs` is present and active; a **cold load** of `/runs/<id>` (stubbed API) lands on the detail header with that id; no redirect to `/workflows`.
- `pnpm --filter @kontra/console-svelte run guard` — `overflow.mjs` on the list at 390px.

### Step 2 — The snapshot

`runInputs.ts` store + `GET/PUT /api/runs/:runId/input` + the `workflowControl.startRun` stamp; `routes.gen.ts` regenerated; `prefill.ts`, `outputColumns.ts`; `RunInput.svelte`, `RunOutput.svelte`; the §3.3 dimension gating.

**Tests**
- core vitest: `prefillValues` — a recorded key the schema dropped lands in `extras`; a newly declared field lands in `missing`; typed values stringify to what `Field.svelte` consumes. `orderColumns` — declaration order wins, undeclared columns are appended and flagged, a schema with no `properties` sorts alphabetically.
- orchestrator vitest: both start paths write the snapshot; a swallowed store failure still returns a started run; the Temporal fallback decodes one payload; **401 without the run token**; `truncated` on an oversized input.
- svelte vitest: the five §3.3 cases render their exact sentences.
- e2e: a stubbed `completed` + `unrecorded` run shows the sentence and **no `<table>`**; a stubbed run with rows shows the declared column order and a description tooltip; a run with `source:'unavailable'` shows the empty-form sentence.

### Step 3 — Replay, health, guarded re-run

`POST /api/runs/:runId/replay` + `ReplayCard.svelte`; `outcome.ts` + `RunHealth.svelte`; `RedispatchCard.svelte` + `Launch.svelte`'s `?prefill`; move the shared run components into `src/runs/`; add `no-start-from-runs.mjs` to the svelte `guard` script.

**Tests**
- orchestrator vitest: exit 0/1/2 → `ok` / `nondeterministic` / `unrunnable`; a timeout maps to `unrunnable` with a reason; the route is token-gated.
- core vitest: `outcome.ts` over three fixtures — an annotated schema (`declared: true`), an unannotated one hitting the heuristic (`declared: false`), and one that matches nothing (`"declares no health field"`, failures not invented).
- **The safety e2e**: press `Replay history` with `page.route` recording every request — assert **zero** requests to `POST /api/runs`, and that the guarantee text is on screen. Then: with `source:'unavailable'`, `Re-dispatch…` is disabled and states why; with an input present, pressing it opens the confirmation and **still** issues no start until the checkbox is ticked, the workflow name is typed, and the handoff lands on `/workflows/<folder>?prefill=<runId>` with the form seeded.
- `pnpm --filter @kontra/console-svelte run guard` now fails if anything under `src/runs/**` reaches for `startRun`.