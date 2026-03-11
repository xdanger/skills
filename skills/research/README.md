# Research Skill

`research` is a resumable skill for deep research workflows. Its goal is to be an
**evidence-aware deep research engine** for modern AI agents: plan the work, gather real
evidence, verify claims, preserve contradictions, survive interruptions, and resume from a
tracked local ledger instead of starting over.

## Goal

The target state of this skill is not “search plus summary.” It is an evidence-aware research
engine with a clear separation between:

- planning artifacts
- candidate URLs
- real evidence
- claim state
- claim assessment
- entities and observations
- queued work
- remote handoff state
- final synthesis

In practical terms, that means:

- Tavily Research is a planning accelerator, not evidence
- claims should be answer-bearing and falsifiable
- evidence should be URL-backed and tied to explicit `claim_links`
- contradictions should be recorded instead of smoothed over
- confidence should come from claim sufficiency, source quality, and source diversity
- continuation should queue targeted follow-up work instead of resetting the whole session
- Manus should remain an async handoff path with a defined rejoin contract, not the default engine

## What This README Is For

This README is for humans maintaining the skill: it explains the design intent, architectural
boundaries, and where different responsibilities belong.

Agent-facing operating instructions, concrete command usage, and workflow details belong in:

- [SKILL.md](SKILL.md)

## Design Principles

The system should stay intentionally simple:

- one local orchestrator
- one versioned session ledger
- one work queue
- one operation journal for checkpoints
- Tavily as the default retrieval engine
- Manus as async fallback only

The core design principle is:

**let scripts enforce reliability, and let the agent spend its intelligence budget on research
judgment**

That means:

- `schema / persistence / work queue / provider contract / handoff` should stay strongly scripted
- `planning / retrieval strategy / evidence attribution / synthesis shape` should stay agent-native
  where possible

## Runtime Model

The engine still reasons in a four-stage loop:

1. `plan`
2. `gather`
3. `verify`
4. `synthesize`

But execution is no longer session-global. The actual runtime unit is a queued `work_item`, such as:

- `plan_session`
- `gather_thread`
- `verify_claim`
- `handoff_session`
- `synthesize_session`

This is what makes the skill resumable: interruptions requeue a concrete work item instead of
rewinding the whole session.

## Session Ledger

The local session ledger is the backbone of the skill. The important objects are:

- `goal`
- `task_shape`
- `threads`
- `claims`
- `entities`
- `observations`
- `planning_artifacts`
- `candidate_urls`
- `evidence`
- `contradictions`
- `scores`
- `stop_status`
- `continuations`
- `work_items`
- `operations`
- `final_answer`
- `handoff`

This separation is deliberate. Planning output must not be allowed to silently behave like
evidence, and derived views such as `scores` or `final_answer` must stay downstream of the ledger,
not act as new source-of-truth.

## Hard Contracts

### 1. Checkpoint Contract

Every external side effect must be wrapped by an `operation` record:

- write the pending operation first
- persist the session
- call the provider
- persist the applied or failed result

This is the minimum contract needed for resumability. Tavily calls are generally safe to retry;
Manus handoffs are not. If a Manus submission is interrupted after the pending checkpoint, the
session must enter a recovery state instead of auto-resubmitting.

### 2. Work Queue Contract

The session owns a queue of explicit work items. Threads and claims keep their own execution state
so the orchestrator can resume targeted work:

- thread gathering rounds
- thread-level open claims
- claim verification freshness
- continuation-scoped rework
- explicit `depends_on` relationships for blocked work

The orchestrator should advance the smallest useful unit of work, not the whole session.

### 3. Evidence Contract

Only `evidence` records can change claim state or confidence.

Evidence records should contain:

- canonical URL metadata
- source type and quality
- publication date when available
- provenance for how the evidence was gathered
- `claim_links[]` with `claim_id`, `stance`, and `reason`

This is the core evidence-aware contract. A single evidence record may support one claim and only
provide context for another.

Each claim also keeps an explicit assessment object so the engine can separate:

- current verdict
- evidence sufficiency
- whether the verdict is tentative, resolved, or contested
- which evidence dimensions are still missing

### 4. Continuation Contract

Continuations should be logged explicitly, not treated as generic notes. A continuation may:

- deepen existing threads
- queue claim re-verification
- create a new follow-up thread

The continuation log is what turns “continue this research” into a durable mutation of the same
session rather than an implicit restart.

### 5. Handoff and Rejoin Contract

Manus remains an async path, but it is no longer a one-way escape hatch.

The handoff contract must define:

- submission state
- queued rejoin state
- recovery state for uncertain submissions
- rejoin schema for remote results
- how remote URL-backed evidence is normalized into the local ledger

Remote results may influence claim state only after they have been imported as normal evidence
records.

## Retrieval Philosophy

The default retrieval path is still:

- `search -> filter -> extract -> verify`

Broad tasks may use Tavily Research to improve planning, but not to support claims directly.
Site-focused tasks default to `map -> extract`, with `crawl` allowed only for scoped audit-style
work. Verification is claim-centric rather than session-centric.

## Current Status

This skill is now built around the contracts above. It has:

- a versioned session ledger
- explicit continuation, work-item, and operation layers
- claim / claim-assessment / evidence / contradiction separation
- entity and observation layers for comparison-heavy work
- claim-centric verification
- checkpointed provider calls
- Manus handoff recovery and rejoin support

What still matters most for quality is not adding more infrastructure, but improving:

- claim-evidence attribution quality
- retrieval strategy quality
- live provider contract protection
- remote result quality when rejoining async work

## Directory Layout

```text
skills/research/
├── SKILL.md
├── README.md
├── references/
│   ├── method.md
│   ├── providers.md
│   └── refactor-plan.md
└── scripts/
    ├── research_session.mjs
    ├── core/
    └── tests/
```

## References

- [SKILL.md](SKILL.md): agent-facing operating
  instructions
- [method.md](references/method.md): research
  loop and evidence standards
- [providers.md](references/providers.md):
  Tavily and Manus roles
- [refactor-plan.md](references/refactor-plan.md):
  deeper architectural roadmap
