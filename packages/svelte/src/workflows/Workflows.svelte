<script lang="ts">
  /**
   * Workflows — what is registered, and the button that runs one.
   *
   * ── THIS SURFACE STARTS RUNS; IT DOES NOT SHOW THEM ─────────────────────────────────────────────
   *
   * It used to be both, and being both is what made it bad at either. Pressing Run set a `watching`
   * id, expanded a run strip, selected a row in a collapsible list, and drew a timeline, a
   * transcript, an asks panel and a log rail — all UNDER the launcher, so the thing you had just
   * started appeared below the fold of the thing you started it with. Meanwhile `/runs/<id>` was a
   * whole surface built to answer exactly that question, and the two disagreed about what a run is.
   *
   * SO RUN NAVIGATES. Pressing it takes you to the run's own page, which is where the progress, the
   * input, the output, the datasets and the logs live, and which keeps working after this tab is
   * closed and reopened. One place a run is shown, and it is the one addressable by a link.
   *
   * ── WHAT WENT, AND WHAT MOVED ───────────────────────────────────────────────────────────────────
   *
   *   the run list        gone — `/runs` is the list, and it is not scoped to one workflow by
   *                       accident the way a collapsible strip under a launcher was
   *   the run strip       gone with it (`RunTail`)
   *   the timeline        `runs/Progress.svelte` answers the same question from the same events,
   *                       and it is honest about the ones it cannot pair
   *   the transcript      the run page's Logs drawer
   *   the log rail        the run page's Logs drawer
   *   Asks                MOVED to the run page, and it had to: a run parked on a question looks
   *                       exactly like a run that is working, and this was the only place that
   *                       said otherwise. Deleting it without moving it would have hidden the one
   *                       state a person has to act on.
   *   the scratch canvas  gone, and it drew nothing: `flowNodes` and `flowEdges` were declared and
   *                       never once assigned, so the toggle opened an empty rectangle. ADR 0026's
   *                       design tab is still owed; an empty canvas was not it.
   */
  import { formatAddress } from '@kontra/console-core/state/address';
  import { parseAddress } from '@kontra/console-core/state/address';
  import Launch from './Launch.svelte';

  /**
   * The workflow the ADDRESS names, if it names one.
   *
   * `/workflows/approve` opens that folder in the launcher. The address's RUN segment is no longer
   * read here — `/workflows?run=<id>` and `/workflows/<w>/<r>` were how a run was reached before it
   * had a page, and `address.ts` still parses them so an old link resolves rather than 404ing.
   */
  const parsed = parseAddress(location.pathname + location.search);
  const addressedWorkflow = $state(parsed?.view === 'workflows' ? (parsed.workflow ?? '') : '');
</script>

<section>
  <h1>Workflows</h1>

  <Launch
    open={addressedWorkflow}
    onstarted={(id) => {
      /*
       * STRAIGHT TO THE RUN, and a document load rather than a pushState.
       *
       * `App.svelte` moves between surfaces with `location.assign` for the reason `surfaces.ts:go`
       * gives — every surface is its own entry — and a run page reached any other way would be a
       * half-mounted view under this one's state. A run is over in under a minute; the page has to
       * be there for the beginning of it, not after a click.
       */
      location.assign(formatAddress({ view: 'runs', run: id }));
    }}
  />
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }

  h1 {
    font-size: var(--t-head);
    font-weight: 600;
    margin: 0;
  }
</style>
