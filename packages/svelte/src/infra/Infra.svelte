<script lang="ts">
  /**
   * Infra — the Machine is the subject, and what is serving hangs off it.
   *
   * ── EVERYTHING HERE IS A BOX, AND ACTORS ARE NOT A SECTION ──────────────────────────────────────
   *
   * ADR 0052 §6: "A read-only Surface whose subject is the Machine, split into the control stack and
   * the fleets — one engine each, visibly. Under each Machine is whatever is serving on it." So there
   * is no Workers list and no Queues list on this page: a Worker is drawn INSIDE the box it runs on,
   * because "which Machine is this Worker on" is the question every incident starts with and a flat
   * list of thirteen queues cannot answer it.
   *
   * The split is the two-engine boundary made visible (ADR 0052 §1): the control stack is the HOST
   * engine's and outlives every Run; a Fleet is `orchestrator-infra`'s and dies with its last Lease.
   * Nothing converges across it.
   *
   * ── A SECTION OF `/settings`, NOT A NINTH NAV SURFACE — AND THAT IS NOT A DOWNGRADE ─────────────
   *
   * ADR 0052 §6 is headed "Settings gains `Infra`" and the prototype's own crumb reads
   * `Settings › Infra`, so this IS the drawn design. The reason it is not also a nav entry today is
   * mechanical and lives in another repository: a nav Surface is reachable by its own first path
   * segment ONLY if `control/orchestrator/src/server.ts`'s `SPA_SURFACES` carries it, and a segment
   * missing there 404s on a COLD load while every in-app click keeps working — "which is what let the
   * same bug ride a release once already" (`lib/surfaces.ts:4-9`; `surfaces.test.ts:49-53` is the
   * guard, and it reads the orchestrator's file off disk).
   *
   * PROMOTING IT IS SIX LINES AND NO NEW CODE, in this order, because the middle one is the only one
   * that makes the address real:
   *   1. `control/orchestrator/src/server.ts` — add `'infra'` to `SPA_SURFACES`
   *   2. `control/orchestrator/src/spaFallback.test.ts` — its restated list, and `size` 10 → 11
   *   3. `packages/core/src/state/surfaces.ts` — a `DECLARED` entry (`id`, `label`, `hint`)
   *   4. `packages/core/src/state/address.ts:123` — join the arm that carries nothing
   *   5. `packages/svelte/src/lib/surfaces.ts` — `{ id: 'infra', label: 'Infra' }`
   *   6. `packages/svelte/src/App.svelte` — `infra: () => import('./infra/Infra.svelte')`
   * plus the three pinned counts (`lib/surfaces.test.ts:46`, `state/surfaces.test.ts:23-32`,
   * `state/address.test.ts:61`). Doing 3–6 without 1–2 is exactly the failure this file is quoting.
   *
   * ── IT READS. THE VERBS ARE ELSEWHERE, ON PURPOSE ───────────────────────────────────────────────
   *
   * No button on this page can change a stack. `infra/dashboard.ts`'s rule stands and this inherits
   * it: converging goes through Temporal so the operation has an id, a retry policy and a record —
   * `kontra up` for the control stack, `kontra fleet` for a Fleet. A "converge" button here would be
   * a second way to start a 60-minute Pulumi update, with no record and no mutex.
   *
   * ── NOTHING IS DERIVED IN THIS FILE ─────────────────────────────────────────────────────────────
   *
   * The join is `@kontra/console-core/infra/machines` and the fetching is `./load.ts`; both have
   * suites. What is here is the DRAWING — which is also why the poll state arrives as a string this
   * file only switches on: a component that recomputed freshness would be a second freshness window.
   *
   * ── FORM, NOT ONLY COLOUR ───────────────────────────────────────────────────────────────────────
   *
   * Each poll state gets a WORD, a GLYPH and its own `border-left-style` (solid / double / dotted /
   * dashed). The four are the whole point of the page — ADR 0052 §6 forbids rounding them off — and a
   * reader who cannot separate red from amber must still be able to separate a Worker that is serving
   * from one the Placement converged and never started. `e2e/infra.spec.ts` asserts the four styles
   * are four, in Chromium, because a CSS class that resolves to the same computed style as its
   * neighbour is invisible to every test that only reads text.
   *
   * The same rule reaches the two things this page gained for ADR 0052 §6's other half. A converge
   * TICK is three pixels wide, so it cannot carry a border style — its form axis is FILL TEXTURE:
   * solid, solid-with-a-halo, horizontally striped, hollow, diagonally hatched. A DRIFT verdict is a
   * chip like the poll flag, with `≡ / ≠ / ? / !` beside the word.
   *
   * ── THE CONVERGE STRIP, AND WHY THE TOOLTIP IS A NATIVE `title` ─────────────────────────────────
   *
   * One tick per Pulumi history record on the stack header, height by duration. The arithmetic — the
   * epoch unit, the ordering, the height floor, the cap — is `@kontra/console-core/infra/history`,
   * which has 26 tests against records copied off the live volume. What is here is the bar.
   *
   * "Changes on hover" is a `title` attribute and not a hover card. It works on a keyboard focus walk,
   * a screen reader reads it, it needs no JavaScript, and `scripts/no-raw-html.mjs` bans the
   * `{@html}` a rich tooltip usually wants. Playwright then asserts an attribute rather than racing a
   * transition — the same reason `pollRow` already puts `stateHint` in a `title`.
   *
   * THE STRIP SCROLLS INSIDE ITSELF rather than widening the page. 60 ticks at a 4px pitch is 240px,
   * which fits every viewport `overflow.mjs` drives — but a control plane with a busier stack than
   * this volume's 51-record one must not be able to push the document sideways.
   *
   * ── REGISTRY DRIFT, AND THE ONE ANSWER IT MUST NEVER GIVE ───────────────────────────────────────
   *
   * `programs/fleet.ts:15-17` records the failure: "Baking `cachebuster:0.2.0` into cloud-init is how
   * this fleet silently ran stale code for weeks." `dockerFleet.ts:126` refuses a placement that is
   * not `repo@sha256:<64 hex>`, so the digest a Worker runs is exactly known; whether the tag still
   * MEANS that digest is not, and `infra/drift.ts` is the comparison.
   *
   * A REGISTRY THAT CANNOT BE REACHED DRAWS `unknown`. Never drift. The sentence is shown for the two
   * actionable states and kept in the `title` for `unknown` — on an install with no resolve route
   * every row would otherwise carry the same paragraph, which is a page of noise around the one row
   * that says something.
   */
  import { driftWord, shortDigest, type DriftState } from '@kontra/console-core/infra/drift';
  import { stateHint, stateWord, type PollState, type ServingRow, type StackRow } from '@kontra/console-core/infra/machines';
  import { formatAge } from '@kontra/console-core/panels/widgets/format';

  import { loadInfra, type Loaded } from './load';

  let loaded = $state<Loaded | undefined>(undefined);
  let error = $state('');
  let busy = $state(false);

  /**
   * Read once on mount, and again when the reader asks.
   *
   * NOT AN INTERVAL, AND NOT A STREAM. `scripts/no-polling.mjs` fails the build on `setInterval`, and
   * there is no stream to ride: `EventSource` cannot set a header and does not go through the wrapped
   * `window.fetch` (`core/run/logstream.ts:17-23`), so a session-gated route like `/api/infra/*`
   * cannot be subscribed to at all. What changes these facts is somebody converging something, which
   * is a deliberate act — so the re-read is one too.
   */
  async function read(): Promise<void> {
    busy = true;
    try {
      loaded = await loadInfra();
      error = '';
    } catch (e) {
      // A throw here is a bug in the loader rather than a failed read — every failed read is already
      // a row in `missing`. Said out loud so it does not render as an empty page.
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void read();
  });

  /** ONE GLYPH PER STATE, so the state survives being read in greyscale or at 390px. */
  const GLYPH: Record<PollState, string> = {
    serving: '●', // ●
    stale: '◑', // ◑
    undated: '○', // ○
    'nothing-polling': '×', // ×
    unknown: '?',
  };

  /**
   * ONE GLYPH PER DRIFT STATE, and the two that matter are mathematical rather than lexical: `≡` and
   * `≠` say "the same" and "not the same" in every language and survive greyscale, which a green tick
   * beside a red tick does not.
   */
  const DRIFT_GLYPH: Record<DriftState, string> = {
    current: '≡',
    drifted: '≠',
    unknown: '?',
    unpinned: '!',
  };

  /** `sha256:aaaaaaaaaaaa` from a bare Bundle sha — twelve hex, the length `docker images` prints and
   *  the length an operator compares by eye. The full value is in the row's `title`. */
  function shortSha(sha: string): string {
    return sha.length <= 12 ? sha : `${sha.slice(0, 12)}…`;
  }

  /**
   * `51 converges · 2 failed · +12 earlier` — what the strip beside it cannot say.
   *
   * THE ELIDED COUNT IS NOT OPTIONAL. A strip capped at 60 ticks on a stack with 72 records has
   * dropped twelve, and a timeline that silently begins in the middle is a timeline that lies about
   * when the stack was created.
   */
  function stripSub(c: { total: number; failed: number; elided: number }): string {
    const bits = [`${c.total} converge${c.total === 1 ? '' : 's'}`];
    if (c.failed > 0) bits.push(`${c.failed} failed`);
    if (c.elided > 0) bits.push(`+${c.elided} earlier`);
    return bits.join(' · ');
  }

  const fleets = $derived(loaded?.view.fleets ?? []);
  const control = $derived(loaded?.view.control ?? []);
  const unattributed = $derived(loaded?.view.unattributed ?? []);

  const controlMachines = $derived(control.reduce((n, s) => n + s.machines.length, 0));
  const fleetMachines = $derived(fleets.reduce((n, s) => n + s.machines.length, 0));
  const fleetPrice = $derived(fleets.reduce((n, s) => n + s.priceMonthly, 0));

  /** `1 machine` / `12 machines`, and the price only when something priced. 0 is unknown, never free. */
  function stackSub(s: StackRow): string {
    const bits = [`${s.machines.length} machine${s.machines.length === 1 ? '' : 's'}`];
    if (s.priceMonthly > 0) bits.push(`$${s.priceMonthly.toFixed(2)}/mo`);
    return bits.join(' · ');
  }
</script>

<section class="infra" data-testid="infra">
  <h2>Infra</h2>
  <p class="muted">
    Every Machine this control plane owns, and what is serving on it. The boxes are Pulumi's — what it
    converged. What runs inside them is Temporal's. Nothing here can change a stack: converging is
    <code>kontra up</code> and <code>kontra fleet</code>, which go through Temporal so the operation
    has an id, a retry policy and a record.
  </p>

  <div class="bar">
    <button type="button" onclick={() => void read()} disabled={busy}>
      {busy ? 'reading…' : 're-read'}
    </button>
    {#if loaded && loaded.roles.length > 0}
      <span class="roles mono">roles={loaded.roles.join(',')}</span>
      <span class="b">KONTRA_ORCHESTRATOR_ROLES</span>
    {/if}
  </div>

  {#if error}
    <p class="err" role="alert">{error}</p>
  {:else if loaded === undefined}
    <p class="muted">reading…</p>
  {:else}
    <!-- WHICH ASK FAILED, NAMED. An absent report and an empty one are different facts, and the poll
         states below say `unknown` for the first — this list is what turns that into something
         actionable rather than a page of question marks. -->
    {#if loaded.missing.length > 0}
      <ul class="missing" data-testid="infra-missing">
        {#each loaded.missing as m (m.url)}
          <li><span class="mono">{m.url}</span><span class="w">{m.why}</span></li>
        {/each}
      </ul>
    {/if}

    <dl data-testid="infra-facts">
      <dt>machines</dt>
      <dd>
        {loaded.view.machines}
        <span class="sep">· {controlMachines} control · {fleetMachines} fleet</span>
      </dd>
      <dt>stacks</dt>
      <dd>
        {control.length + fleets.length}
        <span class="sep">· {control.length} control · {fleets.length} fleet</span>
      </dd>
      {#if fleetPrice > 0}
        <dt>fleet list price</dt>
        <dd class="mono">${fleetPrice.toFixed(2)}/mo</dd>
      {/if}
    </dl>

    {#snippet pollRow(r: ServingRow)}
      <!-- KEYED ON ITS OWN IDENTITY. `r.key` is `<machine>::<queue>` and `r.state` was folded from the
           pollers whose host IS `r.machine` — see `infra/machines.ts`. Nothing in this markup can put
           one Machine's verdict under another's name, the same way `Runs.svelte:169` derives its chips
           from `rows.find((r) => r.runId === openRun)`. -->
      <div class="w {r.state}" data-testid="poll-{r.key}" data-state={r.state} data-queue={r.queue}>
        <div class="w-top">
          <span class="w-actor mono">{r.title}{#if r.version}&nbsp;<span class="v">{r.version}</span>{/if}</span>
          <span class="flag {r.state}" title={stateHint(r.state)}>
            <span class="glyph" aria-hidden="true">{GLYPH[r.state]}</span>{stateWord(r.state)}
          </span>
        </div>
        <!-- THE QUEUE, because it is what you paste to dispatch at this Worker without holding a
             Fleet. Suppressed when the title already IS the queue — the unattributed rows below have
             no actor to name, so the queue is their title and printing it twice reads as two facts. -->
        {#if r.title !== r.queue}
          <div class="w-line mono"><span class="grow">{r.queue}</span></div>
        {/if}
        {#if r.identity}
          <div class="w-line mono">
            <span class="grow">{r.identity}</span>
            <span class="at">{formatAge(r.lastPoll, Date.now())}</span>
          </div>
        {/if}
        {#if r.unknown}
          <div class="w-line mono bad"><span class="grow">{r.unknown}</span></div>
        {/if}

        <!-- ── WHAT THIS WORKER IS RUNNING ────────────────────────────────────────────────────────
             The digest first, because it is the fact; the verdict about it second. `r.drift` is
             `undefined` for a Placement with no container image at all (a DigitalOcean Fleet runs a
             Bundle natively), which draws no line rather than an empty one — `Settings.svelte:32`'s
             rule for every fact on this surface. -->
        {#if r.drift}
          <div
            class="w-line mono digest {r.drift.state}"
            data-testid="digest-{r.key}"
            data-drift={r.drift.state}
            title="{r.image} — {r.drift.why}"
          >
            <!-- BOTH DIGESTS ON THE ROW WHEN THEY DIFFER, in one line: the pair IS the finding, and
                 an operator reading "drifted" alone has nothing to act on. `unpinned` has no digest
                 to shorten, so it prints the reference the Fleet program would have refused. The
                 explaining sentence is the stack's, said once — see `machines.ts:DriftNote`. -->
            <span class="grow">
              {#if r.drift.pinned === undefined}{r.image}
              {:else if r.drift.now !== undefined && r.drift.state === 'drifted'}
                {shortDigest(r.drift.pinned)} → {shortDigest(r.drift.now)}
              {:else}{shortDigest(r.drift.pinned)}{/if}
            </span>
            <span class="dflag {r.drift.state}">
              <span class="glyph" aria-hidden="true">{DRIFT_GLYPH[r.drift.state]}</span>{driftWord(r.drift.state)}
            </span>
          </div>
        {/if}
        <!-- THE OTHER ANSWER TO THE SAME QUESTION. A cloud Fleet's Worker runs a Bundle the Machine
             curled and checked with `sha256sum`, so the bytes are pinned with no image; drift is not
             computed from it because re-resolving a Bundle walks manifest → config → layer
             (`activities/fleet.ts:230-266`), which no route offers. -->
        {#if r.bundleSha}
          <div class="w-line mono" data-testid="bundle-{r.key}" title="bundle sha256:{r.bundleSha}">
            <span class="grow">bundle {shortSha(r.bundleSha)}</span>
          </div>
        {/if}

        {#each r.notes as n (n)}
          <div class="w-line mono note"><span class="grow">{n}</span></div>
        {/each}
      </div>
    {/snippet}

    {#snippet convergeStrip(s: StackRow, c: NonNullable<StackRow['converges']>)}
      <div class="strips" data-testid="strip-{s.fqn}">
        <!-- A FIXED-HEIGHT BASELINE, so two ticks of different duration are comparable at all. The
             ticks sit on the bottom rule; without it a 4px tick and a 24px tick read as two marks at
             unrelated positions rather than as a short converge and a long one. -->
        <div class="strip">
          {#each c.ticks as t (t.key)}
            <!-- `title` CARRIES THE WHOLE RECORD: op, result, duration, change counts and the UTC
                 instant — `history.ts:convergeTitle`. It is repeated as `aria-label` on `role="img"`
                 rather than made focusable with `tabindex`: a bar that takes focus and does nothing
                 is a promise of an action there is none of, and a screen reader reaches an image role
                 through its own navigation without one. -->
            <span
              class="tick {t.tone}"
              data-testid="tick-{s.fqn}-{t.key}"
              data-tone={t.tone}
              style="height: {(t.height * 100).toFixed(1)}%"
              title={t.title}
              role="img"
              aria-label={t.title}
            ></span>
          {/each}
        </div>
        <span class="sub mono">{stripSub(c)}</span>
      </div>
    {/snippet}

    {#snippet stackBox(s: StackRow)}
      <section class="stackbox" data-testid="stack-{s.fqn}">
        <div class="stackhead">
          <span class="fqn mono">{s.fqn}</span>
          <span class="sub mono">{stackSub(s)}</span>
          {#if s.updated}<span class="pill">converged {formatAge(Date.parse(s.updated), Date.now())}</span>{/if}
        </div>

        <!-- ONE TICK PER CONVERGE, ON THE HEADER OF THE STACK IT BELONGS TO (ADR 0052 §6).
             `s.converges` is ABSENT when nobody asked — the route is issue 13's and does not exist yet —
             and a strip with no ticks when the route answered and the stack has never converged. The
             two are different facts and only the second draws anything. -->
        {#if s.converges && s.converges.ticks.length > 0}
          {@render convergeStrip(s, s.converges)}
        {:else if s.converges}
          <p class="none mono">no converge on record</p>
        {/if}

        <!-- THE SENTENCE, ONCE PER PLACEMENT. Drift is a property of the Placement — every Worker of
             one runs the same digest — so the verdict belongs on every row and the explanation belongs
             here. Measured at 390px on a four-Machine Fleet: per-row it was sixteen lines of identical
             prose, and forty-eight on a twelve-Machine one. It WRAPS, because it names two digests and
             a tag and the half that gets ellipsised is the half that says what a re-deploy changes. -->
        {#if s.driftNotes.length > 0}
          <ul class="drifts" data-testid="drift-{s.fqn}">
            {#each s.driftNotes as n (n.key)}
              <li class={n.drift.state}>
                <span class="who mono">{n.title}{#if n.version}&nbsp;<span class="v">{n.version}</span>{/if}</span>
                <span class="say">{n.drift.why}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if s.machines.length === 0}
          <p class="none mono">nothing converged</p>
        {:else}
          <div class="machines">
            {#each s.machines as m (m.key)}
              <div class="m" data-testid="machine-{m.name}">
                <div class="m-head"><span class="m-name mono">{m.name}</span></div>
                <!-- `status` IS WHAT PULUMI RECORDED AT CONVERGE, drawn as a fact and never as
                     health: the checkpoint is written once and a Machine that died an hour ago still
                     reads `active`. Liveness on this page is the poll state below. -->
                {#if m.size || m.region || m.status}
                  <div class="m-meta mono">
                    {[m.size, m.region, m.status].filter(Boolean).join(' · ')}
                  </div>
                {/if}
                {#if m.address}<div class="m-meta mono">{m.address}</div>{/if}
                {#if m.serving.length === 0}
                  <!-- DIFFERENT WORDS FOR THE TWO HALVES, because they are different facts. A Fleet
                       Machine with nothing on it has NO PLACEMENT — capacity somebody is paying for
                       and nothing was placed on. A control-stack container polling no queue is
                       `postgres`, and calling that "no placement" would import Fleet vocabulary into
                       a stack that has no Placements and never will. -->
                  <div class="none mono">{s.kind === 'fleet' ? 'no placement' : 'polls no queue'}</div>
                {:else}
                  <div class="workers">
                    {#each m.serving as r (r.key)}{@render pollRow(r)}{/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- A QUEUE WITH NO BOX. Shown for the same reason the unattributed bucket exists: a
             `kontra-datasets` row reading `nothing polling` is the most actionable line on this page,
             and having no Machine to sit under is precisely what is wrong with it. -->
        {#if s.declared.length > 0}
          <div class="declared" data-testid="declared-{s.fqn}">
            <p class="muted">
              Declared by this stack, and no Machine of its own is polling it.
            </p>
            <div class="machines">
              {#each s.declared as r (r.key)}
                <div class="m">{@render pollRow(r)}</div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/snippet}

    <!-- ── CONTROL STACK ───────────────────────────────────────────────────────────────────────── -->
    <div class="group" data-testid="group-control">
      <div class="grouphead control">
        <h3>Control stack</h3>
        <span class="gsub">{controlMachines} container{controlMachines === 1 ? '' : 's'} · host engine</span>
        <span class="grule"></span>
      </div>
      <p class="muted">
        Converged from the host by <code>kontra up</code>. It has no Lease and no cloud provider, so it
        outlives every Run. Its queues come from <code>queueAssignments(roles)</code> — the single
        authority for which queue a role serves — and never from a list written here.
      </p>
      {#if control.length === 0}
        <p class="none mono">no control stack in either state root</p>
      {:else}
        {#each control as s (s.fqn)}{@render stackBox(s)}{/each}
      {/if}
    </div>

    <!-- ── FLEETS ──────────────────────────────────────────────────────────────────────────────── -->
    <div class="group" data-testid="group-fleets">
      <div class="grouphead fleet">
        <h3>Fleets</h3>
        <span class="gsub">
          {fleets.length} stack{fleets.length === 1 ? '' : 's'} · {fleetMachines} machine{fleetMachines === 1
            ? ''
            : 's'}{fleetPrice > 0 ? ` · $${fleetPrice.toFixed(2)}/mo` : ''}
        </span>
        <span class="grule"></span>
      </div>
      <p class="muted">
        Converged by <code>orchestrator-infra</code> on behalf of a Run. Tagged capacity, held by
        Leases — the Machines are destroyed when the last one drops.
      </p>
      {#if fleets.length === 0}
        <p class="none mono">no Fleet has been converged</p>
      {:else}
        {#each fleets as s (s.fqn)}{@render stackBox(s)}{/each}
      {/if}
    </div>

    <!-- ── UNATTRIBUTED ────────────────────────────────────────────────────────────────────────── -->
    <div class="group" data-testid="group-unattributed">
      <div class="grouphead">
        <h3>Unattributed</h3>
        <span class="gsub">{unattributed.length} pollers · no Machine</span>
        <span class="grule"></span>
      </div>
      <p class="muted">
        Identities whose host matches no Machine in either half. <b>Not dropped</b> — a Worker we
        cannot attribute is <code>unknown</code>, not <code>none</code>, and this is where a developer
        running <code>kontra serve --actor</code> against this control plane shows up. Dropping them is
        what otherwise makes a 12-Machine Fleet report thirteen pollers.
      </p>
      {#if unattributed.length === 0}
        <p class="none mono">every poller attributes to a Machine</p>
      {:else}
        <div class="machines">
          {#each unattributed as u (u.key)}
            <!-- NO MACHINE NAME AT THE TOP, because there is no Machine — that is the whole point of
                 this bucket. The row carries the queue and the identity, and the sentence underneath
                 says WHY it could not be put in a box. It wraps rather than clipping: "identity is
                 not <pid>@<host>@<queue>" ellipsised at 390px is the half of the sentence that
                 carries no information. -->
            <div class="m" data-testid="unattributed-{u.identity}">
              {@render pollRow({
                key: u.key,
                machine: '',
                queue: u.queue,
                title: u.queue,
                version: '',
                state: u.state,
                identity: u.identity,
                lastPoll: u.lastPoll,
                notes: [],
              })}
              <p class="m-meta wrap">
                {u.parsed
                  ? `host ${u.host} — no Machine of that name in either half`
                  : 'identity is not <pid>@<host>@<queue>, so it names no host at all'}
              </p>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <p class="foot">
      <b>Four poll states, and the fourth is not a worse third.</b>
      <span class="ok">serving</span> is a poll inside <code>POLL_FRESH_MS</code> (120&nbsp;s).
      <span class="warn">stale</span> is an identity Temporal still lists — it keeps them about five
      minutes after a Worker stops, so the identity alone reports a dead Worker as healthy.
      <span class="dim">undated</span> is Temporal listing an identity without a timestamp, which
      <code>pollIsFresh</code> counts as neither. <span class="bad">nothing polling</span> is a queue
      with no identity at all: the Placement converged, and a dispatch to it hangs to StartToClose —
      which reads as a slow Run rather than a broken one. A fifth, <span class="dim">unknown</span>,
      is Temporal not being askable, and it is never the same answer as nothing polling.
    </p>

    <p class="foot" data-testid="infra-legend">
      <b>The strip on a stack header is one tick per converge, oldest on the left, height by
      duration.</b>
      Hover or focus a tick for the op, the outcome, the change counts and when it ran. A
      <span class="ok">succeeded</span> update is solid; a <span class="bad">failed</span> one is
      haloed, including a failed <em>teardown</em> — which left Machines running, so it is drawn as
      the failure it is and not as a destroy; a <span class="dim">destroy</span> is striped; a
      <span class="accent">preview</span> is hollow, because it changed nothing by definition.
      <b>And every Worker names the digest it is running.</b>
      <code>dockerFleet</code> refuses a placement that is not <code>repo@sha256:&lt;64 hex&gt;</code>,
      so that digest is exact — what is not exact is whether the tag still means it.
      <span class="ok">≡ current</span> is the tag resolving to the same digest;
      <span class="bad">≠ drifted</span> is this Worker on older code than the tag names, and it names
      both digests; <span class="dim">? unknown</span> is a registry that could not be asked, which is
      never the same answer as drift.
    </p>
  {/if}
</section>

<style>
  /* 390px FIRST. One column of cards, every mono line clipped rather than widening the page, and the
     grid only at a width that can hold two cards — `overflow.mjs` drives 320/390/1280 and its usual
     cause list is exactly this (`overflow.mjs:135-137`). */
  .infra { display: flex; flex-direction: column; gap: var(--s-3); min-width: 0; }
  h2 { font-size: var(--t-body); font-weight: 600; margin: 0; }
  h3 { margin: 0; font-weight: 400; }
  .muted { font-size: var(--t-small); color: var(--dim); margin: 0; max-width: 62ch; line-height: var(--lh-body); }
  .muted code, .foot code { font-family: var(--mono); color: var(--fg); }
  .muted b, .foot b { color: var(--fg); font-weight: 600; }

  .bar { display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }
  .bar button {
    background: var(--track); border: 1px solid var(--line); border-radius: var(--radius);
    color: var(--fg); padding: var(--s-1) var(--s-3); font-size: var(--t-small); cursor: pointer;
  }
  .bar button:hover:not(:disabled) { border-color: var(--dim); }
  .bar button:disabled { color: var(--dim); cursor: default; }
  .roles { font-size: var(--t-small); color: var(--dim); }
  .b { font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); }

  .err {
    margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--t-small); color: var(--bad);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent); border-radius: var(--radius);
  }
  .missing { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
  .missing li {
    display: flex; gap: var(--s-2); flex-wrap: wrap; align-items: baseline;
    font-size: var(--t-small); color: var(--warn); padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent); border-radius: var(--radius);
  }
  .missing .w { color: var(--dim); }

  dl {
    display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-3);
    margin: 0; padding: var(--s-3); background: var(--panel);
    border: 1px solid var(--line); border-radius: var(--radius);
  }
  dt { font-size: var(--t-small); color: var(--dim); }
  dd { margin: 0; font-size: var(--t-small); overflow-wrap: anywhere; }
  dd .sep { color: var(--dim); }

  /* The two halves. One engine each, and they never converge each other. */
  .group { display: flex; flex-direction: column; gap: var(--s-2); margin-top: var(--s-4); min-width: 0; }
  .grouphead { display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap; }
  .grouphead h3 {
    font-family: var(--mono); font-size: var(--t-micro); text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--fg);
    border: 1px solid var(--line); border-radius: 3px; padding: 3px var(--s-2);
  }
  .grouphead.control h3 { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .grouphead.fleet h3 { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
  .grouphead .gsub { font-size: var(--t-small); color: var(--dim); }
  .grouphead .grule { flex: 1; height: 1px; background: var(--line); min-width: 20px; }

  .stackbox { display: flex; flex-direction: column; gap: var(--s-2); margin-top: var(--s-3); min-width: 0; }
  .stackhead {
    display: flex; align-items: baseline; gap: var(--s-2); flex-wrap: wrap;
    border-bottom: 1px solid var(--line); padding-bottom: var(--s-2);
  }
  .stackhead .fqn { font-size: var(--t-small); overflow-wrap: anywhere; }
  .stackhead .sub { font-size: var(--t-small); color: var(--dim); }
  .pill {
    font-size: var(--t-micro); font-family: var(--mono); letter-spacing: 0.04em;
    padding: 2px var(--s-2); border-radius: 3px; border: 1px solid var(--line); color: var(--dim);
    white-space: nowrap;
  }

  .machines { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
  .m {
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    padding: var(--s-2) var(--s-3) var(--s-3); display: flex; flex-direction: column; gap: var(--s-1);
    min-width: 0;
  }
  .m-head { display: flex; align-items: baseline; gap: var(--s-2); }
  .m-name {
    font-size: var(--t-small); font-weight: 600; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .m-meta {
    font-size: var(--t-small); color: var(--dim); min-width: 0; margin: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Prose, not an address: it must be READ, so it wraps. `text-overflow: ellipsis` on a sentence
     hides the half that says what to do about it. */
  .m-meta.wrap { white-space: normal; overflow: visible; overflow-wrap: anywhere; line-height: var(--lh-body); }
  .none { font-family: var(--mono); font-size: var(--t-small); color: var(--dim); margin: 0; }

  .workers { display: flex; flex-direction: column; gap: var(--s-2); margin-top: var(--s-1); min-width: 0; }
  .declared { display: flex; flex-direction: column; gap: var(--s-2); }

  /* ── THE FOUR STATES, IN FORM AS WELL AS IN COLOUR ──────────────────────────────────────────────
     Four distinct `border-left-style`s, one glyph each, and the word itself. 3px because `double`
     needs three pixels to draw two lines; below that the browser silently renders it solid, which
     would make `stale` and `serving` the same shape. */
  .w { border-left: 3px solid var(--line); padding-left: var(--s-2); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .w.serving { border-left-style: solid; border-left-color: var(--ok); }
  .w.stale { border-left-style: double; border-left-color: var(--warn); }
  .w.undated { border-left-style: dotted; border-left-color: var(--dim); }
  .w.nothing-polling { border-left-style: dashed; border-left-color: var(--bad); }
  .w.unknown { border-left-style: dashed; border-left-color: var(--dim); }

  .w-top { display: flex; align-items: baseline; gap: var(--s-2); min-width: 0; }
  /* WRAPS, unlike every other mono line in this card. The title is an actor name on a Fleet and a
     PURPOSE SENTENCE on the control stack ("dataset write, paging and retention"), and clipping that
     to "dataset write, paging and r…" throws away the half a reader came for. Actor names are short,
     so wrapping costs nothing on the other half. */
  .w-actor { font-size: var(--t-small); flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .w-actor .v { color: var(--dim); }
  .flag {
    font-size: var(--t-micro); font-family: var(--mono); text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--dim); white-space: nowrap; flex: none;
    display: inline-flex; align-items: baseline; gap: var(--s-1);
  }
  .flag.serving { color: var(--ok); }
  .flag.stale { color: var(--warn); }
  .flag.nothing-polling { color: var(--bad); }
  .glyph { font-size: var(--t-small); line-height: 1; }

  .w-line {
    font-size: var(--t-small); color: var(--dim); min-width: 0;
    display: flex; gap: var(--s-2); align-items: baseline;
  }
  .w-line .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .w-line .at { flex: none; }
  .w-line.bad { color: var(--bad); }
  .w-line.note { color: var(--accent); }

  /* ── THE DIGEST LINE, AND ITS VERDICT ───────────────────────────────────────────────────────────
     A drifted digest is the one row on this page that means somebody is running code they did not
     deploy, so it is the only line that gets the foreground colour rather than `--dim`: a fact this
     consequential must not be the same weight as the queue name above it. */
  .w-line.digest.drifted .grow, .w-line.digest.unpinned .grow { color: var(--fg); }
  /* THE ONE MONO LINE ON THIS CARD THAT WRAPS. Every other one clips because an ellipsised identity
     still identifies; an ellipsised digest PAIR hides the half that says what a re-deploy would put
     there — measured at 1280px, where a 360px card cut `sha256:bbbbb…` off the drifted row. */
  .w-line.digest .grow { white-space: normal; overflow: visible; overflow-wrap: anywhere; }
  .dflag {
    font-size: var(--t-micro); font-family: var(--mono); text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--dim); white-space: nowrap; flex: none;
    display: inline-flex; align-items: baseline; gap: var(--s-1);
  }
  .dflag.current { color: var(--ok); }
  .dflag.drifted { color: var(--bad); }
  .dflag.unpinned { color: var(--warn); }
  /* One note per Placement, on the stack. Prose: it names two digests and a tag, so it must be READ —
     `ellipsis` here hides the half that says what a re-deploy would change. */
  .drifts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-1); }
  .drifts li {
    display: flex; flex-direction: column; gap: 2px; min-width: 0;
    padding: var(--s-2) var(--s-3); border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
  }
  .drifts li.unpinned { border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
  .drifts .who { font-size: var(--t-small); color: var(--fg); overflow-wrap: anywhere; }
  .drifts .who .v { color: var(--dim); }
  .drifts .say {
    font-size: var(--t-small); line-height: var(--lh-body); color: var(--bad);
    overflow-wrap: anywhere;
  }
  .drifts li.unpinned .say { color: var(--warn); }

  /* ── THE CONVERGE STRIP ─────────────────────────────────────────────────────────────────────────
     24px of baseline. `align-items: flex-end` puts every tick on the bottom rule so two durations are
     comparable; `overflow-x: auto` keeps a busier stack than this volume's 51-record one from pushing
     the document sideways — the one thing `overflow.mjs` fails the build for. */
  .strips { display: flex; flex-direction: column; gap: var(--s-1); min-width: 0; }
  .strip {
    display: flex; align-items: flex-end; gap: 1px; height: 24px;
    border-bottom: 1px solid var(--line); padding-bottom: 1px;
    overflow-x: auto; overflow-y: hidden; min-width: 0;
  }
  /* 3px, because a tick a finger or a pointer cannot land on carries no tooltip — and the tooltip is
     where the change counts live. `flex: none` so 60 ticks do not shrink to sub-pixel slivers. */
  .tick { flex: none; width: 3px; min-height: 2px; background: var(--dim); border-radius: 1px; }
  .tick:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  /* FIVE TONES, FIVE FILL TEXTURES. A tick is three pixels wide so it cannot carry a border style the
     way a poll row does; texture is the axis that is left, and it is the axis that survives greyscale.
       ok       solid
       failed   solid, plus a halo that makes it visibly wider than its neighbours
       destroy  horizontal stripes — a column that has been cut
       preview  hollow: it changed nothing, by definition, and must never look like an update that did
       running  diagonal hatch — unsettled */
  .tick.ok { background: var(--ok); }
  .tick.failed { background: var(--bad); outline: 1px solid var(--bad); outline-offset: 1px; }
  .tick.destroy {
    background: repeating-linear-gradient(to bottom, var(--dim) 0 2px, transparent 2px 4px);
  }
  .tick.preview { background: transparent; box-shadow: inset 0 0 0 1px var(--accent); }
  .tick.running {
    background: repeating-linear-gradient(135deg, var(--warn) 0 2px, transparent 2px 5px);
  }

  .foot {
    border-top: 1px solid var(--line); padding-top: var(--s-3); margin: var(--s-4) 0 0;
    font-size: var(--t-small); color: var(--dim); line-height: var(--lh-body); max-width: 76ch;
  }
  .ok { color: var(--ok); }
  .warn { color: var(--warn); }
  .bad { color: var(--bad); }
  .dim { color: var(--dim); }
  .accent { color: var(--accent); }
  .foot em { font-style: normal; color: var(--fg); }

  /* Two cards only when two fit. 296px is the prototype's measured minimum for a name, a meta line
     and a poll row without the mono text clipping at all. */
  @media (min-width: 680px) {
    .machines { grid-template-columns: repeat(auto-fill, minmax(296px, 1fr)); }
  }
</style>
