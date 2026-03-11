---
name: research
description: Comprehensive, resumable deep research for questions that need iterative web search, evidence tracking, verification, contradiction handling, async handoff, and citation-backed synthesis across multiple passes. Use when Codex should manage a research session instead of answering in one shot, especially for landscape scans, comparisons, due diligence, verification, site-focused investigation, or long-running research that may need Tavily and Manus together.
---

# Research

Use this skill to run research as a checkpointed session with a local ledger, not a single prompt.
The engine is intentionally small: one orchestrator, one ledger, one work queue, and four stages.

## Goals

- Decompose the user's question into research threads and answer-bearing claims.
- Track claim assessments separately from raw verdicts so tentative claims do not look resolved.
- Accumulate `entities` and `observations` for comparison-heavy research instead of collapsing everything into umbrella claims.
- Route work across Tavily tools by task shape.
- Record evidence, gaps, contradictions, and confidence after each pass.
- Continue the same session by queueing targeted follow-up work instead of resetting the whole run.
- Escalate to Manus only when Tavily is not the right fit, then rejoin the result back into the ledger.

## Session Flow

Research still reasons in four stages:

1. `plan`
2. `gather`
3. `verify`
4. `synthesize`

Execution happens through queued work items such as `gather_thread` and `verify_claim`.
Dependencies between work items matter: blocked work should wait until its `depends_on` items are complete.

Use the bundled script:

```bash
SCRIPT="<SKILL_DIR>/scripts/research_session.mjs"
```

Commands:

```bash
node "$SCRIPT" start --query "Research the AI coding agent landscape in 2026"
node "$SCRIPT" status --session-id <session_id>
node "$SCRIPT" continue --session-id <session_id> --instruction "Dig deeper on pricing and enterprise adoption"
node "$SCRIPT" rejoin --session-id <session_id> --payload-file /path/to/remote-result.json
node "$SCRIPT" report --session-id <session_id>
node "$SCRIPT" sources --session-id <session_id>
node "$SCRIPT" close --session-id <session_id>
```

Optional flags:

- `--depth quick|standard|deep`
- `--domains domain1,domain2`
- `--format md|json` for `report`

## Continuation Rules

Treat `continue` as a durable session mutation.

- If the instruction asks to verify or double-check, queue claim-level verification work.
- If the instruction deepens an existing angle, queue follow-up gathering for the relevant thread.
- If the instruction introduces a new angle, create a follow-up thread and gather evidence for it.

Do not wipe the ledger just because the user asked to go deeper.

## Remote Rejoin

When a Manus handoff returns, rejoin it into the local session with `rejoin`.
The payload is queued as `rejoin_handoff` work and then normalized back into the ledger.

The payload should be JSON and should preferably contain:

- `summary`
- `remaining_gaps`
- `evidence[]`

Each remote evidence item should include:

- `url`
- `title`
- `excerpt`
- `source_type`
- `quality`
- `published_at`
- `claim_links[]`

Each `claim_links[]` item should include:

- `claim_id` or `claim_text`
- `stance` as `support`, `oppose`, or `context`
- `reason`

Remote output is not evidence until it has been normalized into the local ledger.
Once imported, rejoin evidence may queue follow-up claim verification work.

## Output Order

Present research outputs in this order:

1. Research plan
2. Interim findings
3. Evidence gaps
4. Final synthesis with citations
5. Confidence and unresolved questions

## Routing Policy

Default to Tavily. Choose the narrowest tool that fits the next work item.

### Default Path: Search Then Extract

Use `search -> extract` as the normal path for most research work.

### Optional Accelerator: Tavily Research

Use `research` as an accelerator for:

- broad synthesis
- market or competitor scans
- comparisons
- trend analysis
- "understand this topic deeply"

Do not treat `research` as evidence. Normalize its output into planning artifacts only.

### Use Tavily Search

Use `search` when the session needs:

- breadth across domains
- date-sensitive verification
- explicit source diversification
- targeted follow-up questions

### Use Tavily Extract

Use `extract` after `search` when:

- top results need closer reading
- you need evidence excerpts from specific URLs
- you need quote verification or more precise support

### Use Tavily Map

Use `map -> extract` for site-focused tasks such as:

- docs sites
- changelogs
- policy pages
- product or developer documentation

Avoid broad crawl-first orchestration unless the task is explicitly audit-like.

### Escalate to Manus

Escalate only when:

- the task is clearly long-running
- the user wants a PDF, PPT, or CSV deliverable
- connectors are needed
- the remote agent asks a follow-up and the work must continue asynchronously

Use the existing Manus skill resources:

- `<REPO_ROOT>/skills/manus/SKILL.md`
- `<REPO_ROOT>/skills/manus/scripts/manus_client.mjs`

## Stop or Continue

Stop when:

- critical questions are answered with acceptable confidence
- new searches mostly duplicate existing evidence
- source diversity is adequate and no major contradiction remains
- the depth budget is exhausted and the remaining gaps are explicit

Continue when:

- contradictions remain unresolved
- evidence quality is weak
- too many claims rely on a single source
- a continuation queued new thread or claim work

## References

Load these only when needed:

- `references/method.md` for the research loop
- `references/providers.md` for Tavily versus Manus decisions
