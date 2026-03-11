# Research Refactor Plan

This document turns the current architecture review into a concrete refactor plan for
`skills/research/`.

The goal is not to make the skill more complex for its own sake. The goal is to raise
research quality, make confidence scores more trustworthy, and keep the implementation
operationally simple enough for an MVP-to-v1 transition.

## Objectives

- Improve answer quality on broad, verification-heavy, and site-focused research tasks
- Make the ledger reflect real evidence rather than synthetic summaries
- Make stopping criteria and confidence scores more trustworthy
- Reduce wasteful search and extract calls without sacrificing coverage
- Keep the default orchestration local, deterministic, and debuggable
- Preserve Manus as an async escalation path instead of making it the default engine

## Non-Goals

- No vector database in this refactor
- No multi-agent planner / researcher / verifier mesh
- No custom crawler stack to replace Tavily
- No attempt to fully automate subjective synthesis without explicit evidence tracking

## Why Refactor Now

The current provider choices are reasonable:

- Tavily is a good default for `search`, `extract`, `map`, and optional `research`
- Manus is a good async fallback for long-running or artifact-heavy work
- A local session ledger is the right backbone for resumable research

The main problems are in the orchestration layer, not the providers:

- synthetic Tavily Research output is treated like evidence
- claim support is inferred from weak lexical overlap
- the extract stage does not use score thresholds, source budgets, or claim-level routing
- broad research claims are process-shaped instead of answer-shaped
- confidence is derived from noisy signals, so stage transitions are easier to game

## Success Criteria

The refactor is successful when all of these are true:

- Broad research produces answer-bearing claims, not generic placeholders
- A claim is not marked supported unless at least one real URL-backed evidence record supports it
- Contradictions are tied to concrete claims and concrete evidence, not generic overlap
- `quick`, `standard`, and `deep` have materially different latency / cost / coverage behavior
- Search and extract calls become easier to audit from session state
- Final synthesis is grounded in claim-level evidence with explicit unresolved gaps

## Target Architecture

### 1. Keep One Orchestrator, But Split Responsibilities

Retain a single local orchestrator. Split the implementation into clear modules so the
logic is easier to reason about and test.

Suggested structure:

```text
skills/research/scripts/
├── research_session.mjs         # CLI entrypoint only
├── core/
│   ├── session_schema.mjs
│   ├── router.mjs
│   ├── planner.mjs
│   ├── retrieval.mjs
│   ├── verifier.mjs
│   ├── scorer.mjs
│   ├── synthesizer.mjs
│   ├── providers.mjs
│   └── session_store.mjs
└── tests/
    ├── fixtures/
    ├── unit/
    └── integration/
```

This keeps the runtime model simple while removing the current "one large file owns every
concern" bottleneck.

### 2. Introduce a Versioned Session Schema

Add `session_version` so the ledger can evolve without breaking resume flows.

Recommended top-level schema:

```json
{
  "session_version": 2,
  "session_id": "...",
  "status": "open",
  "stage": "plan",
  "task_shape": "broad|verification|site|async",
  "goal": "...",
  "constraints": {
    "depth": "quick|standard|deep",
    "domains": [],
    "time_range": null,
    "country": null
  },
  "threads": [],
  "claims": [],
  "candidate_urls": [],
  "evidence": [],
  "contradictions": [],
  "scores": {},
  "final_answer": {},
  "decision_log": [],
  "runs": [],
  "handoff": null
}
```

Key additions:

- `task_shape`: explicit route instead of relying only on `path_hint`
- `goal`: clear normalized research goal
- `threads`: subtopics or subqueries grouped by intent
- `candidate_urls`: search-stage memory before extraction
- `handoff`: Manus metadata for async continuation
- `session_version`: migration anchor

### 3. Upgrade the Planning Stage

The new planning stage should do more than seed generic questions.

Planning responsibilities:

- normalize the user query into a single `goal`
- classify the task shape:
  - `broad`
  - `verification`
  - `site`
  - `async`
- generate 3-6 answer-bearing research threads
- create concrete claims under each thread
- identify high-value unknowns
- record initial stop conditions

Thread examples for a market scan:

- product landscape
- pricing and packaging
- deployment and security posture
- enterprise adoption and proof points
- workflow and UX differences

Claim examples for a market scan:

- "Vendor A offers both cloud and self-hosted deployment"
- "Vendor B exposes enterprise pricing only through sales"
- "Vendor C positions itself primarily for software teams rather than general knowledge work"

Claims should be answer-bearing and falsifiable. Process claims such as "multiple notable
options exist" should move into planning notes, not the claim ledger.

## Retrieval Refactor

### 4. Treat Tavily Research as a Planner, Not Evidence

Keep Tavily Research, but change its role.

Allowed uses:

- generate thread candidates
- produce comparison dimensions
- surface likely entities or domains to investigate
- help build follow-up subqueries

Disallowed use:

- directly supporting or rejecting claims
- increasing coverage or confidence by itself

Implementation rule:

- store Tavily Research output in `threads[].notes` or `planning_artifacts`
- never convert it into `evidence[]`
- never use it for claim status transitions

### 5. Move to Query Fanout Instead of One Big Query

Broad tasks should no longer depend on one merged search string.

New default:

- generate 3-6 subqueries from the plan
- run one search per thread or per high-priority claim cluster
- merge and deduplicate candidate URLs across runs
- extract only from filtered candidates

Benefits:

- better source diversity
- better coverage of subtopics
- less query dilution
- clearer traceability from search run to evidence

### 6. Make `depth` Mean Something Real

Map depth profiles to actual retrieval behavior.

Recommended profile table:

| Depth      | Search            | Fanout                                | Extract                | Verification                              |
| ---------- | ----------------- | ------------------------------------- | ---------------------- | ----------------------------------------- |
| `quick`    | `fast` or `basic` | 1-2 focused queries                   | top 2-3 filtered URLs  | only highest-risk claims                  |
| `standard` | `advanced`        | 3-4 subqueries                        | top 4-6 filtered URLs  | all high-priority claims                  |
| `deep`     | `advanced`        | 4-6 subqueries + optional site branch | top 6-10 filtered URLs | claim-level tie-breakers + recency checks |

Notes:

- `quick` should optimize for speed and cost
- `standard` should be the default quality baseline
- `deep` should add breadth, not just higher `max_results`

### 7. Add Candidate Filtering Before Extract

The current `pickTargetUrls()` strategy is too naive. Replace it with a filtering step that
scores candidate URLs before extraction.

Candidate ranking inputs:

- Tavily `score`
- source type preference:
  - official docs
  - standards bodies
  - government
  - academic
  - credible news
  - vendor / community last
- domain diversity budget
- recency when the claim is time-sensitive
- exact thread or claim match

Filtering rules:

- enforce a minimum score threshold
- cap URLs per domain to avoid overfitting to one site
- reserve at least one slot for primary or official sources when available
- prefer extracted follow-ups from the highest-value threads, not only top-ranked global results

### 8. Add Claim-Level Retrieval in Verification

Verification should become claim-centric.

New verification flow:

1. Take unresolved or contradictory high-priority claims
2. Build one targeted query per claim
3. Add modifiers such as `official`, `primary source`, time hints, or named domains
4. Search and filter candidates
5. Extract supporting and opposing evidence
6. Record whether a tie-breaker source was found

This makes contradictions explainable and prevents one large query from muddying all claims
at once.

## Site-Focused Refactor

### 9. Keep `map -> extract` as the Default

This is still the right default for docs, changelogs, policy pages, and product sites.

### 10. Add a Controlled `crawl` Branch

Do not crawl by default. Add a gated branch for cases where coverage matters more than
speed.

Enable `crawl` only when:

- the task asks for audit-like coverage
- the site has relevant pages not likely to rank via search
- page structure is nonstandard
- the user explicitly asks for exhaustive site coverage

Guardrails:

- always start with `map`
- use `select_paths` and `select_domains` when possible
- keep crawl scope narrow
- use `extract_depth=advanced` only when the content warrants it

This follows Tavily's current guidance: `map` for structure discovery, `crawl` for deeper
content coverage.

## Claim and Evidence Contract

### 11. Replace Lexical Claim Matching with Explicit Evidence Attribution

The current overlap-based support detection should be removed.

New claim model:

```json
{
  "claim_id": "...",
  "thread_id": "...",
  "text": "...",
  "priority": "high|medium|low",
  "status": "open|supported|mixed|rejected|insufficient",
  "why_it_matters": "...",
  "evidence_ids": [],
  "last_checked_at": "..."
}
```

New evidence model:

```json
{
  "evidence_id": "...",
  "run_id": "...",
  "url": "...",
  "domain": "...",
  "title": "...",
  "excerpt": "...",
  "source_type": "official|docs|academic|news|vendor|community",
  "quality": "high|medium|low",
  "retrieval_score": 0.0,
  "published_at": null,
  "claim_links": [
    {
      "claim_id": "...",
      "stance": "support|oppose|context",
      "reason": "..."
    }
  ]
}
```

Implementation notes:

- attribution should happen after targeted review, not through token overlap alone
- the same evidence can support one claim and only provide context for another
- `context` should not count as support

### 12. Separate Planning Artifacts from Evidence

Create separate storage for:

- `planning_artifacts`
- `candidate_urls`
- `evidence`

Only `evidence` can affect claim status and session confidence.

## Scoring and Stop Criteria

### 13. Rebuild Confidence Around Claim Sufficiency

Replace the current confidence formula with a claim-centric sufficiency model.

Recommended components:

- `claim_coverage_score`
  - how many high-priority claims have at least one URL-backed evidence record
- `primary_source_score`
  - how many supported claims have at least one primary or official source
- `source_diversity_score`
  - domain count and source-type diversity across supported claims
- `contradiction_penalty`
  - unresolved mixed claims
- `recency_score`
  - only for time-sensitive tasks

Important rule:

- no synthetic source can increase sufficiency or confidence

### 14. Make Stop Criteria Explainable

A session should stop only when the system can say why.

Record:

- which high-priority claims are sufficiently supported
- which claims remain mixed or insufficient
- whether additional searches are low-yield
- whether the task stopped because of time / cost / user depth limits

Add a `stop_status` object:

```json
{
  "decision": "continue|stop|handoff",
  "reason": "...",
  "open_claim_ids": [],
  "remaining_gaps": []
}
```

## Synthesis Refactor

### 15. Synthesize by Thread, Then by Claim

The final answer should no longer join claim text together.

New synthesis flow:

1. build a summary per thread
2. cite the strongest evidence behind that thread
3. surface disagreements explicitly
4. produce a final answer with:
   - answer summary
   - evidence-backed findings
   - unresolved questions
   - confidence explanation

This produces much more useful reports for broad research and keeps verification tasks
focused.

### 16. Make Citations Traceable

Every synthesis section should cite evidence records that map back to URLs and claims.

Do not cite:

- planning notes
- synthetic summaries
- empty or deduplicated placeholders

## Provider Strategy

### 17. Keep Tavily as the Default Local Engine

Continue using:

- `search` for breadth
- `extract` for close reading
- `map` for structure discovery
- `crawl` only when coverage justifies it
- `research` only as a planning accelerator

### 18. Improve Tavily Parameter Usage

Adopt the following rules:

- prefer shorter, focused queries
- split broad research into subqueries
- use score-based filtering before extract
- use domain filters only when the task truly needs them
- use date and country filters for time-sensitive or geography-sensitive tasks
- use Tavily project tracking where the environment supports it

### 19. Keep Manus as an Escalation Path

Preserve the current async handoff model, but make it smarter.

Routing suggestions:

- `manus-1.6-lite` for lightweight exploratory async work
- `manus-1.6` for normal async deliverables
- `manus-1.6-max` only for especially complex artifact-heavy analysis

Expose these decisions in code rather than hardcoding `lite` for every handoff.

Recommended handoff metadata:

```json
{
  "provider": "manus",
  "task_id": "...",
  "task_url": "...",
  "profile": "manus-1.6",
  "reason": "artifact-heavy deliverable",
  "interactive_mode": false
}
```

## Observability and Debuggability

### 20. Log Decisions the Same Way We Log Outputs

Every search, extract, verify, stop, and handoff step should leave behind structured notes.

Log examples:

- why a query was generated
- why a URL was selected or filtered out
- which claim a verification query targeted
- why the session advanced or stopped

This makes tuning much easier than relying only on final reports.

### 21. Preserve Candidate and Filter Traces

Store:

- raw search result count
- selected candidate URLs
- filtered-out URLs and reasons
- extracted URLs
- evidence promoted from extraction

Without this, quality problems are hard to debug.

## Migration Plan

### 22. Add Session Upgrading for Existing Sessions

Introduce:

- `upgradeSession(session)` for older ledgers
- default values for new fields
- compatibility logic for `report`, `sources`, and `continue`

Migration rules:

- old synthetic evidence remains readable
- old synthetic evidence should not count toward new sufficiency metrics
- existing sessions may remain resumable in a degraded compatibility mode

## Testing Strategy

### 23. Expand Beyond State-Machine Tests

Keep the current stage-flow tests, but add:

- unit tests for query planning
- unit tests for candidate filtering
- unit tests for evidence attribution
- unit tests for scoring and stop decisions
- integration tests for:
  - broad research
  - claim verification
  - site-focused docs review
  - contradiction resolution
  - Manus handoff

### 24. Add Golden Research Fixtures

Create a small offline fixture suite with stable mocked provider outputs.

Suggested fixture set:

- broad market scan
- compliance verification
- pricing comparison
- docs-site architecture investigation
- contradictory announcement or changelog case

Each fixture should assert:

- generated threads
- chosen candidate URLs
- final claim states
- final citations
- unresolved gaps

### 25. Add Quality Regression Checks

Define a lightweight evaluation set of 15-25 representative prompts and compare:

- claim coverage
- citation quality
- primary-source rate
- contradiction resolution rate
- total Tavily calls
- median completion time

This is the minimum needed to prove the refactor improved outcomes.

## Implementation Phases

### Phase 0: Scaffolding and Schema

Deliverables:

- split the monolith into modules
- add `session_version`
- add `goal`, `task_shape`, `threads`, `candidate_urls`, `handoff`
- add migration helpers

Acceptance:

- old CLI commands still work
- existing tests still pass after adaptation

### Phase 1: Planning and Retrieval Rewrite

Deliverables:

- answer-bearing threads and claims
- Tavily Research demoted to planning-only
- subquery fanout
- candidate filtering and domain budgeting
- real depth profiles

Acceptance:

- broad sessions show multiple targeted searches
- no synthetic artifact affects claim status

### Phase 2: Verification and Evidence Rewrite

Deliverables:

- claim-level verification queries
- explicit `claim_links`
- contradiction model tied to claim + evidence
- new scoring model

Acceptance:

- mixed claims become explainable from ledger contents
- confidence no longer rises from synthetic summaries

### Phase 3: Site Mode and Manus Upgrade

Deliverables:

- controlled `crawl` branch
- Manus profile strategy
- structured handoff metadata

Acceptance:

- site-focused sessions use `crawl` only when justified
- async handoffs record why the route was chosen

### Phase 4: Synthesis, Reporting, and Evaluation

Deliverables:

- thread-first synthesis
- citation traceability
- expanded report sections
- fixture-based evaluation suite

Acceptance:

- final reports are materially more informative than current claim concatenation
- evaluation metrics show improved primary-source support and fewer unsupported claims

## Recommended Build Order

If we want the best return on effort, implement in this order:

1. Separate synthetic planning output from evidence
2. Replace generic broad claims with answer-bearing threads and claims
3. Add subquery fanout and candidate filtering
4. Rewrite claim attribution and contradiction handling
5. Rebuild scoring and stop criteria
6. Improve synthesis and reporting
7. Add controlled `crawl`
8. Upgrade Manus routing and handoff metadata

## Risks

- A stricter evidence contract may initially lower confidence scores
- More targeted queries can raise Tavily call count if not budgeted by depth
- Session migration adds compatibility complexity
- Better synthesis depends on better claim structure, so phases should not be skipped

These are acceptable tradeoffs. Lower but more honest confidence is better than inflated
confidence from synthetic or weakly matched evidence.

## References

- Tavily Search Best Practices
- Tavily Extract Best Practices
- Tavily Crawl Best Practices
- Tavily Research Best Practices
- Tavily Search API Reference
- Tavily Research API Reference
- Tavily Changelog
- Manus Create Task API Reference
- Manus OpenAI Compatibility Guide
