"""dnssweep — page a Dataset, resolve each Batch, then ask which of them answer HTTP.

Two deployed Actors in two languages, driven by one caller-owned loop: dnsfacts (Go) answers
the DNS question, probe (Python) the HTTP one.

THE WHOLE MODEL IS ONE SENTENCE:

    A Dataset yields Batches. A Method call returns `(results, dropped)`, and `results` is a Batch.

Which is why this file has no data in it. `targets` is a name in the lake, not a list someone
passed in; every arrow below is a ~110-byte ref; and `resolved` — the output of one Method —
goes straight into the next without a single row entering this workflow's history. That is
ADR 0007 held at the seam that used to break it: before Batches, chaining meant fetching every
result into workflow memory and re-sending it.

    ┌ the control machine ──────┐        ┌ the fleet ─────────────────────┐
    │ DnsSweep (this file)      │──ref───┤ dnsfacts@0.1.0  (Go actor)     │
    │  page → resolve → probe   │──ref───┤ probe@0.1.0     (Python actor) │
    └───────────────────────────┘        └────────────────────────────────┘
             │ refs only
    ┌ the lake ─────────────────┐
    │ "targets" ──▶ "live"      │
    └───────────────────────────┘

Run it:

    kontra serve --actor examples/go/dnsfacts
    kontra serve --actor examples/python/probe
    kontra workflow serve examples/python/workflows/dnssweep.py
    kontra workflow start examples/python/workflows/dnssweep.py --wait \
        --input '{"dataset": "targets", "into": "live"}'

    kontra db query "SELECT count(*) FROM live"      # …while the sweep is still running

WHAT TO NOTICE. There is no `.results` anywhere, and no `len(rows)`. A Batch already knows how
many units it holds and how many were dropped — both ride on its ref's meta — so the loop reads
counts without ever downloading anything. `await batch.rows()` exists for when you genuinely
want the records, and it is deliberately something you have to type.

TWO WIDTHS, NOT ONE. `batches(size)` sizes what goes IN, but a Method's fan-out is its author's
business: a host with six A records emits six units, so a 200-unit page comes back as ~1200.
`resolved.batches(size)` re-pages it before the next Actor sees it — otherwise one activity on
one worker carries 1200 units past the measured 200/1000 guard, with no parallelism and no
isolation boundary between them.

THE WRITE SIDE IS A SCOPE, not a verb you have to remember. `live` reads `open` for as long as
the `async with` is running, and `sealed` once it exits cleanly; a crash never reaches the exit,
so it stays `open` — which is how a reader tells "the producer died" from "there was nothing to
find". The caller hands `out` to the call as its second argument (ADR 0028 §2), and the call itself
publishes each returned Batch into `live` — one publish per chunk, when the call returns, in place
of a hand-written `out.publish(...)` at the bottom of the loop. `live` is queryable before the
sweep ends because each chunk lands as its call returns; mid-chunk, the pushed rows are visible at
the `units/run={run_id}` blob level `kontra monitor --query` reads, not in `live` until the call
returns. Its rows carry the Machine that produced them, and nothing accumulates in workflow memory.
Sealing stays the caller's, because the actor is one of possibly several producers and cannot know
when the Dataset is done.

ERRORS. Nothing here fails the workflow on the framework's judgement (ADR 0023 §14). A dropped
Unit is simply absent from `results`, so the next stage operates on survivors and a failure never
poisons the rest of the chain. Every Method call hands back `(results, dropped)` (ADR 0028 §4) —
you cannot bind the survivors without naming the drops, which is what replaced raise-by-default:
the caller who ignores a drop did so on purpose. `len(dropped)` costs no fetch and `await
dropped.rows()` gets the Units back. Nothing is retried automatically: re-dispatching a drop is a
decision, and `examples/python/workflows/sweep.py` shows one way to make it.

NARRATION. The derived turns say which Actor ran on how much; only `speak` can say what this run
MEANT by any of it, because that is not in the log. Note WHERE the two sentences below are: one
before the loop and one after it, never inside — the page loop is unbounded in a real corpus, and a
sentence per page is five history events and a second of wall clock each. `speak` returns
immediately, which is what separates it from `ask`, the other half of the pair: that one stops the
run until a human answers.
"""
from temporalio import workflow

from actorkit import catalog, speak


@workflow.defn
class DnsSweep:
    @workflow.run
    async def run(self, req: dict) -> dict:
        name = req.get("dataset") or "targets"
        out_name = req.get("into") or "live"
        size = int(req.get("size") or 200)

        targets = catalog.dataset(name)
        pages = resolved_units = probed_units = 0
        dropped = 0

        await speak(f"paging {name} in batches of {size}; resolving, then probing what answers")

        async with catalog.actor("dnsfacts", "0.1.0") as dns, \
                   catalog.actor("probe", "0.1.0") as probe, \
                   catalog.dataset(out_name).writer() as out:
            # `order_by` is required: a materialized dataset stamps no row id, so paging
            # without one may overlap or skip units and nothing would raise.
            async for batch in targets.batches(size, order_by="host"):
                pages += 1

                # `(results, dropped)`: `resolved` is a ref to what dnsfacts committed, and the
                # drops are named beside it (ADR 0028 §4) rather than raised. Dropped units are
                # simply NOT in `resolved` — the next stage sees survivors only, so a failure
                # never poisons the rest of the chain.
                resolved, drops = await dns.addrs(batch)
                dropped += len(drops)
                resolved_units += len(resolved)

                # A host with 6 A records emits 6 units, so a 200-unit page can come back as
                # 1200 — re-page before the next Actor sees it. Unconditional on purpose: a
                # Batch that already fits yields itself and schedules nothing, so the 1:1 case
                # pays nothing and no caller has to write the `if len(...) > size` branch.
                async for chunk in resolved.batches(size):
                    # STREAMING, not gathering. `out` is the call's second argument (ADR 0028 §2),
                    # so the Actor's output lands in `live` as it is pushed — `live` is queryable
                    # while this loop is still running, `await out.publish(...)` is gone, and the
                    # rows carry the Machine that produced them rather than one value for all.
                    checked, drops = await probe.head(chunk, out)
                    dropped += len(drops)
                    probed_units += len(checked)

        # After the scope, so the sentence can say `live` is SEALED — a crash never reaches this
        # line, which is exactly how a reader tells "the producer died" from "there was nothing to
        # find". One sentence for the whole sweep, whatever it paged.
        await speak(f"{probed_units} rows into {out_name} from {pages} page(s); {dropped} dropped")

        return {
            "dataset": name,
            "into": out_name,
            "pages": pages,
            "resolved": resolved_units,
            "probed": probed_units,
            # Isolation is not an error and will not fail this workflow (ADR 0023 §14), so it
            # has to be VISIBLE: a sweep that dropped everything and one that found nothing
            # must not render identically.
            "dropped": dropped,
        }


if __name__ == "__main__":
    catalog.serve([DnsSweep])
