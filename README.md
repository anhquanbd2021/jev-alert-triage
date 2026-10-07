# Alert Triage Lab — companion demo

Interactive lab for the article *Who Decided That Alert Was a P1? A YAML File
From Last Year.* Four alerts share the same firing condition (`cpu > 90% for
10m`) but carry different runtime context. The static rule says `critical` for
all of them; the decision layer answers severity, pageability, owning team, and
deploy-relatedness per alert — then plain-code policy decides who gets paged.

Zero dependencies — Node 20+ only. `app/triage.mjs` implements the article's
pipeline (enrich → decide → route) with a deterministic stand-in for the
`/v1/systemone` model call: logistic scoring produces closed-space severity
distributions, a calibrated-looking `pageable` probability, and a confidence
the routing policy gates on.

## What it proves

| Alert | YAML severity | Decision-layer verdict |
|---|---|---|
| Staging load test | critical | P3 — channel, not page |
| Prod payments, fast SLO burn, fresh deploy | critical | P1 — page `payments` |
| Batch jobs, flapping, runbook exists | critical | P3 — channel |
| Novel latency spike, no runbook | warning | low confidence → duty-engineer queue |

Low confidence routes to humans on purpose — that's the design, not a bug.

## Run it

```text
npm start   # lab on :3000
npm test    # routing thresholds, closed answer space, replay coverage
```
