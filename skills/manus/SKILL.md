---
name: manus
description: "Delegate complex tasks to Manus — autonomous AI agent for deep web research, file generation (PDF/PPT/CSV), data analysis, and long-running multi-step workflows. Use when the task exceeds Tavily/sub-agent scope: 10+ site deep research, document generation, 30min+ autonomous workflows, or tasks needing Manus connectors such as Gmail, Notion, or Google Calendar."
metadata:
  openclaw:
    emoji: "🤖"
    requires:
      bins: ["uv"]
      env: ["MANUS_API_KEY"]
    primaryEnv: "MANUS_API_KEY"
---

# Manus — External AI Agent

## Overview

Manus is an autonomous AI agent that independently executes complex, multi-step tasks inside its own cloud sandbox. Tasks run asynchronously (minutes to hours) and results are delivered via polling or webhook.

**Core flow:** Enrich prompt with Kros's context → create Manus task → poll/wait for webhook → process results → reply to user.

## When to Use Manus

- **Deep web research** — 10+ sites, cross-referencing, comprehensive reports
- **Document generation** — PDF reports, PPT presentations, CSV datasets
- **Multi-step autonomous workflows** — 30+ minutes of sequential work
- **Connector-dependent tasks** — Gmail inbox analysis, Notion queries, Calendar coordination
- **Data collection at scale** — scraping, aggregation, comparative analysis across many sources

## When NOT to Use Manus

- **Quick lookups** — use Tavily (`tavily_search` / `tavily_research`)
- **Instant responses** — Manus tasks take minutes minimum
- **Code tasks** — use coder sub-agent or codex model
- **OpenClaw internal operations** — cron, config, memory management
- **Simple web fetch** — use `web_fetch` or Firecrawl

## Prompt Enrichment Protocol

Before delegating to Manus, **always enrich the prompt** with relevant context:

1. **Extract from MEMORY.md** — preferences, past decisions, ongoing projects relevant to the task
2. **Extract from USER.md** — personal info that shapes the task (location, family, work)
3. **Specify output format** — "output as PDF", "respond in Chinese", "structured as table"
4. **Set scope boundaries** — what to include/exclude, depth vs breadth
5. **⚠️ Never include** — passwords, API keys, tokens, or sensitive credentials in the prompt

Official docs live at `https://open.manus.im/docs` as of March 10, 2026. Some official Manus pages still link `https://open.manus.ai/docs`; treat that as an alias and prefer the `.im` docs site when citing docs.

## Script Commands

All commands use `uv run` with the skill script:

```bash
SCRIPT="<SKILL_DIR>/scripts/manus_client.py"
```

### Create task
```bash
uv run $SCRIPT create \
  --prompt "Your enriched prompt here" \
  --mode agent \
  --profile manus-1.6 \
  --session-key "agent:main:direct:+18598888882" \
  --locale zh
```

Optional flags: `--attachment /path/to/file` (repeatable), `--connector <uuid>` (repeatable), `--task-id <id>` (continue multi-turn)

### Check status
```bash
uv run $SCRIPT status --task-id <task_id>
```

Use `--convert` when you want Manus to convert PPTX output on retrieval.

### Get result (+ download attachments)
```bash
uv run $SCRIPT result --task-id <task_id>
# Attachments auto-download to ~/.openclaw/media/YYYYMM/
```

### List recent tasks
```bash
uv run $SCRIPT list --limit 10 --status completed
```

### Delete task
```bash
uv run $SCRIPT delete --task-id <task_id>
```

This maps to Manus `DELETE /v1/tasks/{task_id}` and permanently deletes the task.

## Session Tracking

- **Always pass `--session-key`** when creating tasks — this routes webhook results back to the originating chat session
- The session key should match the current session identifier (e.g., `agent:main:direct:+18598888882`)
- Task registry at `~/.openclaw/cache/manus-tasks.json` maps task IDs to session keys

## Multi-Turn Conversations

When Manus returns `stop_reason: "ask"`:
1. Relay Manus's question to the user in the original chat
2. After user responds, continue the task: `--task-id <original_id> --prompt "user's answer"`

## Cost Awareness

- **Default to `manus-1.6`** for most tasks
- **Use `manus-1.6-lite`** for exploratory/experimental tasks, quick tests
- **Use `manus-1.6-max`** only when explicitly requested or task clearly needs maximum capability
- **When uncertain about a task** — confirm with Kros before creating, describe estimated scope/cost

## Files & Entry Points

- **Script:** `<SKILL_DIR>/scripts/manus_client.py`
- **API reference:** `<SKILL_DIR>/references/api.md`
- **Setup guide:** `<SKILL_DIR>/references/setup.md`
- **Webhook transform:** `<SKILL_DIR>/scripts/webhook-transform.js`
- **Task registry:** `~/.openclaw/cache/manus-tasks.json` (runtime, auto-created)
