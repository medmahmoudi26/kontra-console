/**
 * The shapes kontra's API actually answers with, and a clock that advances one.
 *
 * WHY MOCK DATA AND NOT A LIVE CALL. A prototype has to be openable with no control plane behind
 * it, or the first person to look at it sees an error page. Every field below is named for the one
 * the real endpoint returns — `/api/runs`, `/api/runs/:id`, `/api/runs/:id/history`, `/api/actors` —
 * so swapping `seed()` for `fetch()` is the whole of the work, not a rewrite.
 *
 * THE SIMULATOR IS THE POINT OF THE PROTOTYPE. The question being answered is whether a Temporal-UI
 * timeline reads well for a kontra Run, and a timeline of finished work answers nothing: the
 * interesting part is a bar that is still growing while you look at it. So `tick()` advances a run
 * in real time and every view is derived from it.
 *
 * SVELTE 5 RUNES, DELIBERATELY. `$state` makes this object deeply reactive — a push into
 * `run.stages[2].units` re-renders exactly the one bar that changed, with no store plumbing and no
 * dependency array. That is the difference this prototype exists to show; in React the same update
 * walks the tree.
 */

/** Wall-clock the simulation runs on. Fixed origin so the layout is reproducible in a screenshot. */
const T0 = 1789327580000;

/** What a Method call looks like while it is happening. `queued` has no bar yet — it has no start. */
export const UNIT_STATES = ['queued', 'running', 'completed', 'failed'];

/**
 * One stage = one Actor placement a workflow dispatches to. `kontra runs list` prints these under
 * STAGES as `actor@version/node`, which is why both halves are separate fields here.
 */
function stage(actor, version, node, startOffset, units) {
  return {
    id: `${actor}-${node}`,
    actor,
    version,
    node,
    startedAt: T0 + startOffset,
    closedAt: 0,
    units,
    /** Filled by the simulator. One entry per Unit: {startedAt, closedAt, state}. */
    bars: [],
  };
}

function freshRun() {
  return {
    runId: 'firstrun-1789327582',
    type: 'FirstRun',
    tenant: 'default',
    status: 'running',
    startedAt: T0,
    closedAt: 0,
    historyLength: 0,
    historySizeBytes: 0,
    dispatches: 0,
    stages: [
      stage('firstactor', '0.1.0', 'n1', 900, 6),
      stage('firstactor', '0.1.0', 'n2', 2400, 6),
      stage('webcrawl', '0.1.0', 'n3', 5200, 4),
      stage('redditapi', '0.1.0', 'n4', 9000, 5),
    ],
    /** `/api/runs/:id/history` — the reduced log (ADR 0025), newest last. */
    events: [{ id: 1, at: T0, type: 'WorkflowExecutionStarted', detail: 'FirstRun' }],
  };
}

/** Everything the three pages read. One `$state` so a nested write re-renders only its own node. */
export const app = $state({
  view: 'workflows',
  run: freshRun(),
  /** Simulated milliseconds since the run started. The timeline's playhead. */
  now: 0,
  playing: true,
  speed: 1,
  selectedStage: null,

  /** `/api/sources/workflow` — what the Workflows surface lists. */
  workflows: [
    { name: 'firstrun', version: '0.1.0', workflow: 'FirstRun', queue: 'wf-firstrun-0.1.0', served: true, lastRun: 'firstrun-1789327582', runs: 12 },
    { name: 'surface', version: '0.1.0', workflow: 'Surface', queue: 'wf-surface-0.1.0', served: true, lastRun: 'surface-1789240100', runs: 48 },
    { name: 'hunt', version: '0.1.0', workflow: 'Hunt', queue: 'wf-hunt-0.1.0', served: false, lastRun: 'hunt-1789102244', runs: 131 },
    { name: 'redditscrape', version: '0.1.0', workflow: 'RedditScrape', queue: 'wf-redditscrape-0.1.0', served: false, lastRun: 'redditscrape-1788904511', runs: 7 },
  ],

  /** `/api/actors` — key, name, version, operations[]. The Method schema is what the form derives from. */
  actors: [
    {
      key: 'firstactor@0.1.0', name: 'firstactor', version: '0.1.0', pollers: 2, lastPoll: 1200,
      operations: [{
        name: 'expand',
        description: 'Expand a host into candidate subdomain labels.',
        input: {
          type: 'object',
          required: ['host'],
          properties: {
            host: { type: 'string', title: 'Host' },
            mode: { type: 'string', enum: ['quick', 'deep'], default: 'quick' },
            follow_redirects: { type: 'boolean', default: false },
            wordlist: { 'x-kontra-input': 'file', title: 'Wordlist' },
            corpus: { 'x-kontra-input': 'folder', title: 'Corpus' },
          },
        },
      }],
    },
    {
      key: 'redditapi@0.1.0', name: 'redditapi', version: '0.1.0', pollers: 0, lastPoll: 0,
      operations: [{
        name: 'fetch',
        description: 'Fetch documents over the OAuth transport.',
        input: {
          type: 'object',
          required: ['subreddit'],
          properties: {
            subreddit: { type: 'string', title: 'Subreddit' },
            sort: { type: 'string', enum: ['new', 'hot', 'top'], default: 'new' },
            include_comments: { type: 'boolean', default: true },
          },
        },
      }],
    },
    {
      key: 'webcrawl@0.1.0', name: 'webcrawl', version: '0.1.0', pollers: 4, lastPoll: 400,
      operations: [{
        name: 'crawl',
        description: 'Drive a browser over a scope and record every exchange.',
        input: {
          type: 'object',
          required: ['seed'],
          properties: {
            seed: { type: 'string', title: 'Seed URL' },
            depth: { type: 'string', enum: ['1', '2', '3'], default: '2' },
            block_media: { type: 'boolean', default: true },
          },
        },
      }],
    },
  ],
});

/** Deterministic jitter, so a rebuild lays the bars out identically. `Math.random` would not. */
function jitter(seed, spread) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * spread;
}

/**
 * Advance the simulation.
 *
 * ONE PASS OVER THE STAGES and it writes only what changed — a Unit that has just finished gets its
 * `closedAt`, and nothing else in the object is touched. That is what keeps the timeline smooth at
 * 60 frames: the runes proxy notices the single field, not the array.
 */
export function tick(dtMs) {
  if (!app.playing || app.run.closedAt) return;
  app.now += dtMs * app.speed;
  const now = app.now;
  let dispatches = 0;
  let events = app.run.events.length;

  for (const [si, st] of app.run.stages.entries()) {
    const offset = st.startedAt - app.run.startedAt;
    if (now < offset) continue;

    // Materialise the Unit bars the first time this stage is reached.
    if (st.bars.length === 0) {
      for (let u = 0; u < st.units; u += 1) {
        const start = offset + 200 + jitter(si * 31 + u, 1400);
        st.bars.push({
          i: u,
          startedAt: start,
          closedAt: 0,
          duration: 1800 + jitter(si * 71 + u, 4200),
          state: 'queued',
          // One unit fails, on purpose: a timeline where everything is green teaches nothing about
          // whether a failure is legible at a glance.
          willFail: si === 2 && u === 1,
        });
      }
      app.run.events.push({ id: ++events, at: app.run.startedAt + offset, type: 'ActivityTaskScheduled', detail: `${st.actor}@${st.version} · ${st.units} units` });
    }

    for (const b of st.bars) {
      if (now < b.startedAt) continue;
      if (b.state === 'queued') { b.state = 'running'; dispatches += 1; }
      if (b.state === 'running' && now >= b.startedAt + b.duration) {
        b.closedAt = b.startedAt + b.duration;
        b.state = b.willFail ? 'failed' : 'completed';
        app.run.events.push({
          id: ++events,
          at: app.run.startedAt + b.closedAt,
          type: b.willFail ? 'ActivityTaskFailed' : 'ActivityTaskCompleted',
          detail: `${st.actor}/${st.node} unit ${b.i}`,
        });
      }
    }
    const done = st.bars.every((b) => b.closedAt);
    if (done && !st.closedAt) st.closedAt = app.run.startedAt + Math.max(...st.bars.map((b) => b.closedAt));
  }

  app.run.dispatches = app.run.stages.reduce((n, s) => n + s.bars.filter((b) => b.state !== 'queued').length, 0);
  // `historyLength` is what ADR 0046 decided the meter counts, so the prototype shows it moving.
  app.run.historyLength = app.run.events.length * 3;
  app.run.historySizeBytes = app.run.historyLength * 412;

  const all = app.run.stages.flatMap((s) => s.bars);
  if (all.length && all.every((b) => b.closedAt) && app.run.stages.every((s) => s.bars.length)) {
    app.run.closedAt = app.run.startedAt + app.now;
    app.run.status = all.some((b) => b.state === 'failed') ? 'failed' : 'completed';
    app.run.events.push({ id: app.run.events.length + 1, at: app.run.closedAt, type: 'WorkflowExecutionCompleted', detail: app.run.status });
  }
}

export function restart() {
  const keep = app.run.runId;
  app.run = freshRun();
  app.run.runId = keep;
  app.now = 0;
  app.playing = true;
}

/** Total span the timeline draws, with headroom so a growing bar never touches the right edge. */
export function span() {
  const ends = app.run.stages.flatMap((s) => s.bars.map((b) => (b.closedAt || app.now)));
  return Math.max(app.now, ...ends, 1) * 1.08;
}

export function fmt(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
