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

## Default Loop

Think in this loop:

1. plan
2. gather
3. verify
4. synthesize

Treat the session as durable state. Do not restart from scratch just because the user asks to go deeper.

## Prefer Agent-Authored Planning

If the task is high-value, ambiguous, or clearly needs custom decomposition, prefer `--plan-file`.

Use agent-authored planning when you already know:

- which threads matter
- which claims are answer-bearing
- which subqueries are worth paying for
- which gaps should stay explicit

The runtime validates and queues the plan. It should not try to out-think the agent.

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

Use fallback planning only when custom planning would be overkill.

## Continuation

Treat `continue` as a durable mutation of the same session.

- If the user asks to verify or double-check, queue claim-level verification.
- If the user deepens an existing angle, queue follow-up gathering for the relevant thread.
- If the user introduces a new angle, add a follow-up thread.
- If the next step needs a new research shape, prefer `continue --plan-file`.

Do not wipe the ledger because the user said “continue.”

When the next step is already clear, prefer a machine-readable continuation patch instead of
forcing the runtime to infer intent from prose.

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

## Evidence Rules

- Treat Tavily Research as planning help, not evidence.
- Only URL-backed evidence should move claim state or confidence.
- Keep contradictions explicit.
- If source quality is weak or one claim depends on one thin source, keep it unresolved.
- Preserve attribution anchors with the evidence when possible:
  `anchor_text`, `matched_sentence`, `excerpt_method`, and `attribution_confidence`.
- Surface those attribution fields in findings, source listings, or other agent-facing evidence
  views whenever possible, not only in raw session JSON.
- Treat attribution as best-effort support metadata, not as proof that the runtime fully
  understands the source.

The session ledger now also persists a lightweight control plane:

- `research_brief`
- `plan_state`
- `plan_versions`
- `activity_history`
- `gaps`

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
5. final synthesis with citations
6. confidence and unresolved questions

## Stop When

- the main question is answered with acceptable confidence
- important claims have good enough evidence
- new searches are mostly repetitive
- the remaining gaps are explicit

Continue when contradictions remain, sourcing is weak, or important claims still hinge on thin evidence.

## Load Only When Needed

- Read `references/method.md` for the research loop and evidence standards.
- Read `references/providers.md` for Tavily versus Manus decisions.
