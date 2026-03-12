---
name: research
description: Comprehensive, resumable deep research for questions that need iterative web search, evidence tracking, verification, contradiction handling, async handoff, and citation-backed synthesis across multiple passes. Use when Codex should manage a research session instead of answering in one shot, especially for landscape scans, comparisons, due diligence, verification, site-focused investigation, or long-running research that may need Tavily and Manus together.
---

# Research

Run research as a resumable session with a local ledger, not as a one-shot answer.

Use this skill when the agent should:

- investigate across multiple passes
- preserve evidence and contradictions
- continue later without restarting
- route work across Tavily and, when needed, Manus

The runtime should enforce reliability. The agent should own research judgment.

## Use The Script

```bash
SCRIPT="<SKILL_DIR>/scripts/research_session.mjs"
```

Common commands:

```bash
node "$SCRIPT" start --query "Research the AI coding agent landscape in 2026"
node "$SCRIPT" prepare --query "Research the AI coding agent landscape in 2026"
node "$SCRIPT" status --session-id <session_id>
node "$SCRIPT" approve --session-id <session_id>
node "$SCRIPT" continue --session-id <session_id> --instruction "Dig deeper on pricing"
node "$SCRIPT" start --query "Does product X support SSO?" --plan-file /path/to/plan.json
node "$SCRIPT" continue --session-id <session_id> --plan-file /path/to/followup-plan.json
node "$SCRIPT" continue --session-id <session_id> --plan-file /path/to/continuation-patch.json
node "$SCRIPT" continue --session-id <session_id> --plan-file /path/to/delta-plan.json
node "$SCRIPT" rejoin --session-id <session_id> --payload-file /path/to/remote-result.json
node "$SCRIPT" report --session-id <session_id>
node "$SCRIPT" sources --session-id <session_id>
node "$SCRIPT" close --session-id <session_id>
```

Useful flags:

- `--depth quick|standard|deep`
- `--domains domain1,domain2`
- `--plan-file /path/to/plan.json`
- `--format md|json` for `report`

Use `prepare` when the agent wants a reviewable plan snapshot before automatic gathering starts.
Use `approve` when a prepared plan should resume normal orchestration.

## Operating Model

The agent decides what to research. The runtime makes sure decisions are durable and replayable.

Default loop:

1. plan — the agent authors the research shape
2. gather — the runtime collects evidence safely
3. verify — the runtime cross-checks claims
4. synthesize — the runtime produces the output

Treat the session as durable state. Do not restart from scratch just because the user asks to go deeper.

When the runtime has no authored next step, it enters `awaiting_agent_decision` instead of
inventing its own plan. The agent should respond with a `--plan-file` or `--delta-file`.

## Agent-Authored Planning (Primary Path)

Always prefer `--plan-file` or `--brief-file` for non-trivial research. The runtime has a
fallback planner for simple queries, but it is low-authority and should not be relied on for
high-value work.

Author a plan when you know:

- which threads matter
- which claims are answer-bearing
- which subqueries are worth paying for
- which gaps should stay explicit

The runtime validates, persists, and queues the plan. It does not try to out-think the agent.
When the runtime uses its fallback planner, it tags the output as `source: "runtime_fallback"`
with `authority: "low"`.

Minimal plan shape:

```json
{
  "plan_id": "landscape-v1",
  "task_shape": "broad",
  "threads": [
    {
      "title": "Pricing and packaging",
      "intent": "compare list pricing and sales-gated plans",
      "subqueries": ["vendor pricing", "vendor enterprise plan"],
      "claims": [
        {
          "text": "The leading vendors differ in pricing visibility and enterprise packaging.",
          "claim_type": "comparison",
          "priority": "high"
        }
      ]
    }
  ]
}
```

You can also include a lightweight `research_brief` so the agent owns more of the soft judgment:

```json
{
  "research_brief": {
    "objective": "Compare leading AI coding agents for enterprise adoption",
    "deliverable": "report",
    "source_policy": {
      "mode": "allowlist",
      "allow_domains": ["openai.com", "anthropic.com"],
      "preferred_domains": ["developers.openai.com"],
      "notes": ["Prefer official pricing and security pages."]
    },
    "clarification_notes": ["Optimize for enterprise buyers, not hobbyists."]
  }
}
```

If a plan may be retried, include a stable `plan_id` so duplicate application can be skipped safely.

Use fallback planning only when the query is simple enough that custom planning would be overkill.
The fallback planner is a compatibility layer, not the system's brain.

## When the Session Awaits Your Decision

When the session enters `awaiting_agent_decision`, the runtime has finished all queued work and
is waiting for the agent to decide the next step. Check `status` or `review` to see:

- which claims are resolved and which remain open
- which contradictions are unresolved
- which gaps remain

Then choose one of:

- `continue --delta-file` with a `synthesize_session` queue proposal to produce the final answer
- `continue --delta-file` with `gather_thread` or `verify_claim` proposals to dig deeper
- `continue --plan-file` to restructure the research entirely
- `close` if the research is no longer needed

To skip this pause entirely, set `auto_synthesize: true` in the `research_brief`.

## Continuation

Treat `continue` as a durable mutation of the same session.

- If the user asks to verify or double-check, queue claim-level verification.
- If the user deepens an existing angle, queue follow-up gathering for the relevant thread.
- If the user introduces a new angle, add a follow-up thread.
- If the next step needs a new research shape, prefer `continue --plan-file`.

Do not wipe the ledger because the user said “continue.”

When the next step is already clear, always prefer a machine-readable continuation patch or
delta plan. Prose instructions (`--instruction`) go through a legacy inference layer that
guesses intent from text — it works for simple cases but should not be the primary path.

Minimal continuation patch shape:

```json
{
  "continuation_patch": {
    "instruction": "Re-check pricing and add an enterprise controls thread",
    "operations": [
      {
        "type": "merge_domains",
        "domains": ["openai.com", "anthropic.com"]
      },
      {
        "type": "mark_claim_stale",
        "claim_id": "claim-123"
      },
      {
        "type": "requeue_thread",
        "thread_id": "thread-123"
      },
      {
        "type": "add_gap",
        "gap": "Need fresher enterprise controls evidence."
      },
      {
        "type": "add_thread",
        "thread": {
          "title": "Enterprise controls",
          "intent": "compare SSO, RBAC, and audit controls",
          "subqueries": ["vendor enterprise controls"],
          "claims": [
            {
              "text": "Enterprise controls differ across the leading vendors.",
              "claim_type": "comparison",
              "priority": "high"
            }
          ]
        }
      }
    ]
  }
}
```

Supported operations in this first slice:

- `merge_domains`
- `mark_claim_stale`
- `requeue_thread`
- `add_gap`
- `note`
- `add_thread`

When the blocker state matters, prefer a typed gap instead of only a free-text string:

```json
{
  "type": "add_gap",
  "gap": {
    "kind": "source_authority",
    "summary": "Need a primary source tie-breaker for pricing visibility.",
    "scope_type": "thread",
    "scope_id": "thread-123",
    "severity": "high",
    "recommended_next_action": "Check official pricing and enterprise packaging pages.",
    "status": "open"
  }
}
```

The runtime persists typed gaps in `gaps[]`. Keep `remaining_gaps` as a backward-compatible text view,
not the primary blocker model.

When the agent already knows what changed and what should happen next, prefer a `delta_plan` over
more prose or more fallback planning.

Minimal delta plan shape:

```json
{
  "delta_plan": {
    "delta_plan_id": "delta-001",
    "summary": "Pricing evidence is stale, and enterprise adoption matters more now.",
    "goal_update": "Compare AI coding agents for enterprise adoption and pricing clarity",
    "source_policy_update": {
      "mode": "allowlist",
      "allow_domains": ["openai.com", "anthropic.com"]
    },
    "gap_updates": [
      {
        "action": "upsert",
        "gap": {
          "kind": "freshness",
          "summary": "Need fresher pricing evidence.",
          "scope_type": "thread",
          "scope_id": "thread-123",
          "severity": "high"
        }
      }
    ],
    "thread_actions": [{ "action": "deepen", "thread_id": "thread-123" }],
    "claim_actions": [{ "action": "mark_stale", "claim_id": "claim-123" }],
    "queue_proposals": [
      {
        "kind": "synthesize_session",
        "scope_type": "session",
        "scope_id": "research-123",
        "reason": "Produce an updated synthesis after the next pass."
      }
    ],
    "why_now": "The blocker map changed and the next step should be explicit."
  }
}
```

Keep this first slice narrow. Let the agent author the delta. Let the runtime validate,
persist, freeze/apply, and queue safely.

Supported `thread_actions` in this slice:

- `deepen`
- `pause`
- `branch`

Supported `claim_actions` in this slice:

- `mark_stale`
- `set_priority`

Supported `queue_proposals.kind` values in this slice:

- `gather_thread`
- `verify_claim`
- `synthesize_session`
- `handoff_session`

Queue proposals must reference a valid existing target:

- `gather_thread` -> `scope_type: "thread"` and an existing thread id
- `verify_claim` -> `scope_type: "claim"` and an existing claim id
- `synthesize_session` / `handoff_session` -> `scope_type: "session"` and the current session id

## Evidence Rules

- Treat Tavily Research as planning help, not evidence.
- Only URL-backed evidence should move claim state or confidence.
- Keep contradictions explicit — they are durable typed objects, not just text.
- If source quality is weak or one claim depends on one thin source, keep it unresolved.
- Evidence carries freshness metadata: `observed_at` (when we saw it) and `last_verified_at`.
- Preserve attribution anchors with the evidence when possible:
  `anchor_text`, `matched_sentence`, `excerpt_method`, and `attribution_confidence`.
- Surface those attribution fields in findings, source listings, or other agent-facing evidence
  views whenever possible, not only in raw session JSON.
- Treat attribution as best-effort support metadata, not as proof that the runtime fully
  understands the source.

When the user's query is in a non-English language, prefer English subqueries for web search
unless the topic is language-specific or regional. Tavily search returns better results with
English queries for most international topics.

Contradictions are structured objects with `conflict_type` (factual_disagreement, temporal,
interpretation, scope), `resolution_strategy`, and `status` (open, resolved, dismissed).
They survive across sessions and are visible in reports and review packets.

The session ledger persists a control plane:

- `research_brief`
- `plan_state`
- `plan_versions`
- `delta_plans`
- `activity_history`
- `gaps`
- `contradictions`

## Routing

Default to Tavily. Choose the narrowest tool that fits the next work item.

- `search -> extract`: normal path for most work
- `research`: planning accelerator for broad scans and topic overviews
- `map -> extract`: default for docs, policy, changelog, or site-focused work
- `crawl`: only for scoped audit-like coverage

Escalate to Manus only when:

- the task is long-running
- connectors are needed
- the user wants an async deliverable such as PDF, PPT, or CSV

Use these Manus resources when needed:

- `<REPO_ROOT>/skills/manus/SKILL.md`
- `<REPO_ROOT>/skills/manus/scripts/manus_client.mjs`

## Rejoin

When Manus returns, rejoin through `rejoin`.

Remote output is not evidence until it is normalized back into the local ledger.

Prefer remote payloads that include:

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

## Output Shape

Present outputs in this order:

1. research plan
2. answer summary
3. interim findings
4. evidence gaps
5. open contradictions
6. final synthesis with citations
7. confidence and unresolved questions

## Stop When

- the main question is answered with acceptable confidence
- important claims have good enough evidence
- new searches are mostly repetitive
- the remaining gaps are explicit

Continue when contradictions remain, sourcing is weak, or important claims still hinge on thin evidence.

## Load Only When Needed

- Read `references/method.md` for the research loop and evidence standards.
- Read `references/providers.md` for Tavily versus Manus decisions.
