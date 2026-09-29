<script lang="ts">
  /**
   * THE MACHINES THIS RUN STOOD UP, drawn as the boxes they are.
   *
   * ── WHY A DRAWING AND NOT A TABLE ───────────────────────────────────────────────────────────────
   *
   * There is already a table: `infra/Infra.svelte` lists every Machine this control plane owns, and
   * it is the right shape for an operator auditing the estate. This region answers a question a table
   * answers badly — "what is my run building, right now" — and it is asked during the one window
   * where the answer changes every few seconds and mostly consists of things that DO NOT EXIST YET.
   * Measured on the canary, 34 of 57 seconds are the bring-up; on a three-Fleet campaign it is
   * minutes. A table of four rows that say `planned` is not a picture of that.
   *
   * So each Machine is a chassis, the Actors placed on it are the cards in it, and the two facts that
   * change — whether the box exists and whether its Worker is polling — are the two things that move.
   *
   * ── EVERY STATE CARRIES ITS WORD ────────────────────────────────────────────────────────────────
   *
   * Colour is the fast read and never the only one. `machines.ts:stateWord` already exists for this
   * and its own header says why: five poll states that must not be rounded off, and `unknown` is
   * never `nothing polling`. A rack that drew a grey box for "we could not ask Temporal" and a grey
   * box for "no Worker is there" would collapse exactly the distinction that module refuses to.
   *
   * ── WHAT IT DOES NOT CLAIM ──────────────────────────────────────────────────────────────────────
   *
   * A Machine's chassis says whether the box EXISTS, from the checkpoint and the engine's cursor. It
   * never says the box is healthy: the checkpoint's `status` field is written at converge and never
   * again, so a Machine that died an hour ago still reads `active` there (`infra/machines.ts`). What
   * a Worker is actually doing is the poll state on its own card, which is a live read, and the two
   * are drawn separately on purpose — a green chassis over a dead Worker is the green-label-over-
   * lost-work failure of ADR 0017.
   *
   * NO ADDRESSES ARE DRAWN. `narrowStack` carries one and this never reads it: a run page is the most
   * screenshotted surface in the console, and the private address of a Machine that is mid-scan
   * against somebody else's infrastructure does not belong in a screenshot. The Infra page, which is
   * where an operator goes to debug one, still shows it.
   */
  import { machineExists, type Cursor, type Rack, type RackFleet, type RackMachine } from '@kontra/console-core/run/fleet';
  import { stateWord, stateHint, type PollState } from '@kontra/console-core/infra/machines';
  import { shortSeconds } from '@kontra/console-core/run/steps';
  import type { Missing } from '../infra/load';

  interface Props {
    rack: Rack;
    /** Reads that did not answer. A silently partial rack is a lie about what this run is spending. */
    missing?: readonly Missing[];
    /** Seconds since the run's first event — the clock the Progress region draws against. */
    now: number;
    /** The first read has not landed yet. Distinguishes "no Fleets" from "not asked". */
    loading?: boolean;
  }
  let { rack, missing = [], now, loading = false }: Props = $props();

  /** Every distinct region the run has Machines in. The number that answers "how many unique source
   *  IPs" at a glance, which is the reason a Fleet is four boxes rather than one. */
  const regions = $derived([
    ...new Set(rack.fleets.flatMap((f) => f.machines.map((m) => m.region)).filter((r): r is string => !!r)),
  ]);

  /** Distinct `<actor>@<version>` placed anywhere in the rack. */
  const actors = $derived([
    ...new Set(rack.fleets.flatMap((f) => f.machines.flatMap((m) => m.actors.map((a) => `${a.name}@${a.version}`)))),
  ]);

  /** Workers polling right now, over Workers the converges placed. The one ratio worth a headline:
   *  a Fleet that converged and is not serving is a run about to hang on StartToClose. */
  const serving = $derived.by(() => {
    const all = rack.fleets.flatMap((f) => f.machines.flatMap((m) => m.actors));
    return { up: all.filter((a) => a.state === 'serving').length, of: all.length };
  });

  /** `0` means UNKNOWN and never free — `programs/fleet.ts` is explicit, because the price is looked
   *  up at converge and the lookup is allowed to fail. So an unpriced Fleet prints no number rather
   *  than `$0`, which would be a claim nobody made. */
  const money = (monthly: number): string =>
    monthly > 0 ? `$${(monthly / 730).toFixed(3)}/h · $${monthly.toFixed(0)}/mo` : '';

  /** What the engine is doing, as a sentence rather than a URN. The URN itself stays one line below
   *  in mono, because it is what an operator pastes into `pulumi stack`. */
  function cursorLine(c: Cursor): string {
    const verb =
      c.op === 'create' ? 'creating' : c.op === 'delete' ? 'destroying' : c.op === 'update' ? 'updating' : c.op || 'on';
    if (c.actor && c.machine) return `${verb} the ${c.actor} Worker on ${c.machine}`;
    if (c.machine) return `${verb} ${c.machine}`;
    return `${verb} ${c.name}`;
  }

  /** What a Fleet's own line says it is doing. `status` is Temporal's and beats the stored phase —
   *  a `stackWorkflow` whose worker died answers `running` for ever. */
  function fleetWord(f: RackFleet): string {
    if (f.failed) return 'failed';
    if (f.converging) return f.op === 'destroy' ? 'tearing down' : f.op === 'preview' ? 'previewing' : 'bringing up';
    if (f.status === 'COMPLETED') return f.op === 'destroy' ? 'torn down' : 'up';
    if (f.status === 'CANCELED') return 'cancelled';
    if (f.status) return f.status.toLowerCase().replace(/_/g, ' ');
    return f.link?.closed ? 'closed' : 'starting';
  }

  /** How long this Fleet's converge took, or has been going. */
  function fleetClock(f: RackFleet): string {
    if (f.link === undefined) return '';
    if (f.link.dur > 0) return shortSeconds(f.link.dur);
    return f.converging ? `${shortSeconds(Math.max(0, now - f.link.t0))} so far` : '';
  }

  const lifeWord: Record<RackMachine['life'], string> = {
    planned: 'not created yet',
    creating: 'creating',
    up: 'up',
    destroying: 'destroying',
    gone: 'gone',
  };

  /** Why a Machine is drawn the way it is, for the reader who hovers rather than guesses. */
  const lifeHint: Record<RackMachine['life'], string> = {
    planned: 'this Fleet asked for this Machine and the checkpoint does not hold it yet',
    creating: 'the engine is creating this Machine right now — the provider call is in flight',
    up: 'the checkpoint holds this Machine. Whether its Workers are serving is the card below, which is a live read',
    destroying: 'the engine is destroying this Machine. It still exists, and is still billing, until the provider says otherwise',
    gone: 'this Fleet is for this Machine, the checkpoint does not hold it, and nothing is building it',
  };

  const tone: Record<PollState, string> = {
    serving: 'ok',
    stale: 'warn',
    undated: 'warn',
    'nothing-polling': 'bad',
    unknown: 'dim',
  };

  /**
   * `nothing polling` IS NOT A FAULT WHILE THE CONVERGE IS STILL RUNNING, and the word does not
   * change — only the tone does.
   *
   * A Fleet spends its whole bring-up in this state: the Droplets exist and the Placement's install
   * Command has not run yet, so every Machine truthfully reports no Worker on it for minutes. Drawn
   * red, a four-Machine Fleet is four red rows for the entire normal case, and a reader who sees
   * that every time stops reading it — so the one that matters, a converge that FINISHED and left a
   * Worker missing, arrives on a page that has been crying wolf since the first second.
   *
   * The state itself is untouched (`machines.ts` keeps five and this collapses none of them): what
   * is said is still "nothing polling", and the title says which of the two situations it is.
   */
  function actorTone(state: PollState, converging: boolean): string {
    return state === 'nothing-polling' && converging ? 'warn' : tone[state];
  }

  function actorHint(state: PollState, converging: boolean, unknown?: string): string {
    if (unknown !== undefined) return unknown;
    if (state === 'nothing-polling' && converging) {
      return 'no Worker is polling yet, and the converge is still running — this is the ordinary state of a Machine whose Placement has not been installed';
    }
    return stateHint(state);
  }

  /** The machine count with its denominator, as ONE expression.
   *
   *  It was markup — `<b>{n}</b>{#if …}<span> of {m}</span>{/if}` — and the leading space inside the
   *  span was swallowed, so a four-Machine Fleet read `4of 4 machines` on screen while every test
   *  passed: `toContainText` normalises whitespace, and so does every assertion anyone would write
   *  for it. A space that only exists in a template's text node is not a space you can rely on. */
  const machineCount = $derived(
    rack.planned === undefined ? '' : ` of ${rack.planned}`
  );
</script>

{#if loading || rack.fleets.length > 0}
  <div class="rack" data-testid="run-rack">
    <div class="head">
      <div class="htext">
        <h2>
          Infrastructure
          {#if rack.converging}<span class="pill busy" data-testid="rack-converging">converging</span>{/if}
        </h2>
        <p class="hsub">
          The Machines this run provisioned, read from Pulumi's checkpoint and the converge's own
          heartbeat. Each box is one Droplet with its own public address — which is the reason a
          Fleet is several Machines rather than one.
        </p>
      </div>
      <div class="hmeta">
        <span data-testid="rack-machines">
          <b>{rack.machines}</b><span class="of">{machineCount}</span>
          machine{rack.machines === 1 ? '' : 's'}
        </span>
        {#if regions.length}<span><b>{regions.length}</b> region{regions.length === 1 ? '' : 's'} <span class="faint">{regions.join(' ')}</span></span>{/if}
        <!-- Not `bad` while a converge is running, for the reason on `actorTone`: a Fleet mid-install
             is SUPPOSED to have Workers that are not serving yet. -->
        {#if serving.of}<span class:bad={serving.up < serving.of && !rack.converging}><b>{serving.up}</b> of {serving.of} worker{serving.of === 1 ? '' : 's'} serving</span>{/if}
        {#if actors.length}<span class="faint">{actors.join(' · ')}</span>{/if}
        {#if money(rack.priceMonthly)}<span class="mono price">{money(rack.priceMonthly)}</span>{/if}
      </div>
    </div>

    {#if missing.length}
      <!-- A PARTIAL RACK SAYS SO. `infra/load.ts:collapse` folds a per-stack read that failed on
           every stack into one row, so this is one line per WAY a read failed, not one per Fleet. -->
      <ul class="missing" data-testid="rack-missing">
        {#each missing as m (m.url + m.status)}
          <li><code>{m.url}</code>{#if m.count}<span class="faint"> ×{m.count}</span>{/if} — {m.why}</li>
        {/each}
      </ul>
    {/if}

    {#if loading && rack.fleets.length === 0}
      <p class="empty">Reading the Fleets this run started…</p>
    {/if}

    {#each rack.fleets as f (f.fqn + (f.link?.execId ?? ''))}
      <section class="fleet" class:converging={f.converging} class:failed={f.failed} data-testid="rack-fleet">
        <div class="fhead">
          <span class="flight {f.failed ? 'bad' : f.converging ? 'busy' : 'ok'}"></span>
          <span class="fname mono">{f.stack}</span>
          {#if f.tag}<span class="ftag">kf-{f.tag}-NN</span>{/if}
          <span class="fword">{fleetWord(f)}</span>
          {#if fleetClock(f)}<span class="fclock mono">{fleetClock(f)}</span>{/if}
          {#if money(f.priceMonthly)}<span class="fprice mono">{money(f.priceMonthly)}</span>{/if}
        </div>

        {#if f.cursor}
          <!-- THE ENGINE'S OWN CURSOR — `activities/infra.ts` heartbeats `{op, urn}` on every
               resourcePreEvent, and until now nothing outside `/api/infra` had ever read it. This is
               the line that makes a four-minute converge legible instead of a spinner. -->
          <div class="cursor" data-testid="rack-cursor">
            <span class="cbeam"></span>
            <span class="ctext">{cursorLine(f.cursor)}</span>
            <code class="curn">{f.cursor.type}</code>
          </div>
        {/if}

        {#if f.machines.length === 0}
          <p class="empty">
            {f.converging
              ? 'No Machine yet — the converge has not created one. The first Droplet usually appears within a minute.'
              : 'This Fleet holds no Machine.'}
          </p>
        {:else}
          <div class="boxes">
            {#each f.machines as m (m.key)}
              <article class="machine {m.life}" data-testid="rack-machine" title={lifeHint[m.life]}>
                <div class="bezel">
                  <span class="leds">
                    <span class="led power"></span>
                    <span class="led net"></span>
                  </span>
                  <span class="mname mono">{m.name}</span>
                </div>

                <!-- The chassis face. Purely a drawing: it carries no fact of its own, which is why
                     every number below it is a label rather than a mark on it. -->
                <div class="face">
                  <span class="vents"></span>
                  <span class="sweep"></span>
                </div>

                <div class="spec">
                  <span class="life">{lifeWord[m.life]}</span>
                  {#if m.region}<span class="mono">{m.region}</span>{/if}
                  {#if m.size}<span class="mono faint">{m.size}</span>{/if}
                </div>

                {#if m.actors.length}
                  <ul class="actors">
                    {#each m.actors as a (a.key)}
                      <li
                        class="actor {actorTone(a.state, f.converging)}"
                        class:placing={a.placing}
                        data-testid="rack-actor"
                      >
                        <span class="adot"></span>
                        <span class="aname">{a.name}</span>
                        <span class="aver mono">{a.version}</span>
                        <span class="astate" title={actorHint(a.state, f.converging, a.unknown)}>
                          {a.placing ? 'installing' : stateWord(a.state)}
                        </span>
                      </li>
                    {/each}
                  </ul>
                {:else if machineExists(m.life)}
                  <!-- A Machine with no Placement is a Machine holding a Fleet with nothing on it —
                       exactly what `fleet.hold()` converges, and exactly what a placement that
                       failed leaves behind. Saying so beats an empty space. -->
                  <p class="noactor">nothing placed</p>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
{/if}

<style>
  .rack {
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    display: flex; flex-direction: column; overflow: hidden;
  }

  .head {
    padding: var(--s-4); border-bottom: 1px solid var(--line);
    display: flex; gap: var(--s-4); align-items: flex-start; flex-wrap: wrap;
  }
  .htext { display: flex; flex-direction: column; gap: var(--s-1); min-width: 0; flex: 1 1 32ch; }
  h2 {
    font-size: var(--t-lead); font-weight: 600; line-height: var(--lh-tight); margin: 0;
    display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap;
  }
  .hsub { font-size: var(--t-small); color: var(--dim); line-height: var(--lh-body); max-width: 72ch; margin: 0; }
  .hmeta {
    display: flex; flex-direction: column; gap: 3px; font-size: var(--t-small); color: var(--dim);
    align-items: flex-end; text-align: right; flex: 0 1 auto;
  }
  .hmeta b { color: var(--fg); font-weight: 600; font-size: var(--t-body); }
  .hmeta .of { color: var(--dim); }
  .hmeta .bad b { color: var(--bad); }
  .price { color: var(--fg); }
  .faint { color: var(--dim); opacity: 0.7; }

  .pill {
    font-size: var(--t-micro); text-transform: uppercase; letter-spacing: 0.07em;
    padding: 1px 7px; border-radius: 10px; border: 1px solid var(--line); color: var(--dim);
  }
  .pill.busy { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }

  .missing { margin: 0; padding: var(--s-3) var(--s-4); list-style: none; border-bottom: 1px solid var(--line); }
  .missing li { font-size: var(--t-small); color: var(--warn); line-height: var(--lh-body); }
  .missing code { font-family: var(--mono); font-size: var(--t-micro); color: var(--dim); }

  .empty { padding: var(--s-3) var(--s-4); font-size: var(--t-small); color: var(--dim); margin: 0; }

  /* ── one Fleet ─────────────────────────────────────────────────────────────────────────────── */
  .fleet { border-bottom: 1px solid var(--track); padding: var(--s-3) var(--s-4) var(--s-4); }
  .fleet:last-child { border-bottom: 0; }

  .fhead { display: flex; gap: var(--s-2); align-items: baseline; flex-wrap: wrap; margin-bottom: var(--s-2); }
  .flight { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); align-self: center; flex: 0 0 auto; }
  .flight.ok { background: var(--ok); }
  .flight.bad { background: var(--bad); }
  .flight.busy { background: var(--accent); animation: beat 1.6s ease-in-out infinite; }
  @keyframes beat {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent); }
    60% { box-shadow: 0 0 0 5px transparent; }
  }
  .fname { font-size: var(--t-body); font-weight: 600; color: var(--fg); }
  .ftag {
    font-family: var(--mono); font-size: var(--t-micro); color: var(--dim);
    border: 1px solid var(--line); border-radius: 3px; padding: 0 5px;
  }
  .fword { font-size: var(--t-small); color: var(--dim); }
  .fleet.converging .fword { color: var(--accent); }
  .fleet.failed .fword { color: var(--bad); }
  .fclock, .fprice { font-size: var(--t-small); color: var(--dim); }
  .fprice { margin-left: auto; }

  /* ── the converge cursor ───────────────────────────────────────────────────────────────────── */
  .cursor {
    display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line));
    border-radius: var(--radius); padding: var(--s-2) var(--s-3); margin-bottom: var(--s-3);
  }
  .cbeam {
    width: 22px; height: 3px; border-radius: 2px; flex: 0 0 auto;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: scan 1.4s ease-in-out infinite;
  }
  @keyframes scan { 0%, 100% { opacity: 0.25; transform: translateX(-3px); } 50% { opacity: 1; transform: translateX(3px); } }
  .ctext { font-size: var(--t-small); color: var(--fg); }
  .curn { font-family: var(--mono); font-size: var(--t-micro); color: var(--dim); overflow-wrap: anywhere; }

  /* ── the Machines ──────────────────────────────────────────────────────────────────────────── */
  .boxes { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: var(--s-3); }

  .machine {
    border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg);
    display: flex; flex-direction: column; overflow: hidden; position: relative;
  }
  /* NOT CREATED YET IS A DASHED OUTLINE, not a faded solid one. A Machine that does not exist must
     not be able to be mistaken for one that does at a glance across a twelve-box Fleet — the
     difference has to survive being looked at sideways, which opacity alone does not. */
  .machine.planned { border-style: dashed; opacity: 0.55; background: transparent; }
  .machine.gone { border-style: dashed; opacity: 0.4; background: transparent; }
  .machine.creating { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
  .machine.destroying { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }

  .bezel {
    display: flex; gap: var(--s-2); align-items: center;
    padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--line);
    background: var(--track);
  }
  .leds { display: flex; gap: 4px; flex: 0 0 auto; }
  .led { width: 6px; height: 6px; border-radius: 50%; border: 1px solid var(--line); background: transparent; }
  .machine.up .led.power, .machine.destroying .led.power { background: var(--ok); border-color: transparent; }
  .machine.up .led.net { background: color-mix(in srgb, var(--ok) 40%, transparent); border-color: transparent; }
  .machine.creating .led.power { background: var(--warn); border-color: transparent; animation: blink 0.9s steps(2, end) infinite; }
  .machine.destroying .led.net { background: var(--bad); border-color: transparent; animation: blink 0.6s steps(2, end) infinite; }
  @keyframes blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.25; } }
  .mname { font-size: var(--t-small); font-weight: 600; color: var(--fg); }
  .machine.planned .mname, .machine.gone .mname { color: var(--dim); font-weight: 400; }

  /* The chassis face — vents, and a sweep that runs only while the engine is on this Machine. */
  .face { position: relative; height: 16px; overflow: hidden; background: var(--bg); }
  .vents {
    position: absolute; inset: 4px var(--s-3);
    background: repeating-linear-gradient(90deg, var(--line) 0 2px, transparent 2px 6px);
    opacity: 0.8;
  }
  .machine.planned .vents, .machine.gone .vents { opacity: 0.35; }
  .sweep { position: absolute; inset: 0; opacity: 0; }
  .machine.creating .sweep {
    opacity: 1;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 40%, transparent), transparent);
    width: 40%;
    animation: sweep 1.5s linear infinite;
  }
  @keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(350%); } }

  .spec {
    display: flex; gap: var(--s-2); align-items: baseline; flex-wrap: wrap;
    padding: var(--s-2) var(--s-3); font-size: var(--t-micro); color: var(--dim);
  }
  .spec .life { color: var(--dim); }
  .machine.creating .spec .life { color: var(--accent); }
  .machine.destroying .spec .life { color: var(--bad); }
  .machine.up .spec .life { color: var(--ok); }

  /* ── the Actors on a Machine ───────────────────────────────────────────────────────────────── */
  .actors { list-style: none; margin: 0; padding: 0 var(--s-2) var(--s-2); display: flex; flex-direction: column; gap: 4px; }
  .actor {
    display: flex; gap: var(--s-2); align-items: baseline; position: relative; overflow: hidden;
    border: 1px solid var(--line); border-radius: 4px; padding: 5px var(--s-2);
    background: var(--panel); font-size: var(--t-small);
  }
  .adot { width: 6px; height: 6px; border-radius: 50%; background: var(--dim); align-self: center; flex: 0 0 auto; }
  .actor.ok .adot { background: var(--ok); }
  .actor.warn .adot { background: var(--warn); }
  .actor.bad .adot { background: var(--bad); }
  .aname { color: var(--fg); font-weight: 500; }
  .aver { font-size: var(--t-micro); color: var(--dim); }
  .astate { margin-left: auto; font-size: var(--t-micro); color: var(--dim); white-space: nowrap; cursor: help; }
  .actor.ok .astate { color: var(--ok); }
  .actor.bad .astate { color: var(--bad); }
  .actor.warn .astate { color: var(--warn); }

  /* INSTALLING IS ITS OWN LOOK, because it is the window in which `nothing polling` is the EXPECTED
     answer rather than a problem. Without it, every Machine in a Fleet reads red for the several
     minutes an install legitimately takes — a rack that looks broken while it is working. */
  .actor.placing { border-color: color-mix(in srgb, var(--accent) 40%, var(--line)); }
  .actor.placing .adot { background: var(--accent); }
  .actor.placing .astate { color: var(--accent); }
  .actor.placing::after {
    content: ''; position: absolute; inset: 0; width: 35%;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 22%, transparent), transparent);
    animation: sweep 1.6s linear infinite;
  }

  .noactor { margin: 0; padding: 0 var(--s-3) var(--s-3); font-size: var(--t-micro); color: var(--dim); }

  /* The rack is decoration in service of a fact; with motion off, every fact is still a word and a
     colour on the page. tokens.css already collapses durations — this stops the sweeps leaving a
     stationary bright band parked over a chassis. */
  @media (prefers-reduced-motion: reduce) {
    .machine.creating .sweep, .actor.placing::after { display: none; }
    .cbeam { background: var(--accent); opacity: 0.8; }
  }
</style>
