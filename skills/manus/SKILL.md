---
name: manus
description: "Delegate complex tasks to Manus — an autonomous AI agent for deep web research, file generation, data analysis, and long-running multi-step workflows. Use when the task exceeds local tools or sub-agents: large research sweeps, deliverables such as PDF/PPT/CSV, connector-based tasks, or work that should run asynchronously for minutes to hours."
---

# Manus

## Overview

Manus is an autonomous AI agent that can execute long, multi-step work inside its own cloud sandbox. Use it when you want an external agent to keep working asynchronously instead of tying up the current session.

Official docs live at `https://open.manus.im/docs` as of March 10, 2026. Some official Manus pages still link `https://open.manus.ai/docs`; treat that as an alias and prefer the `.im` docs site when citing docs.

## When to Use Manus

- Deep research across many sources
- Deliverables such as PDF, PPT, CSV, or structured reports
- Multi-step tasks that may take many minutes
- Connector-dependent work such as Gmail, Notion, or Google Calendar
- Large collection, aggregation, or comparison tasks

## When Not to Use Manus

- Quick lookups that local search tools can answer faster
- Interactive back-and-forth where the user expects immediate replies
- Pure code changes that are better handled in the current workspace
- Small fetches or one-shot extraction tasks

## Prompting Guidance

Before delegating:

1. Pull in only the context that materially helps the task
2. Specify the expected output format
3. Define boundaries: what to include, exclude, or prioritize
4. State any language, locale, or file-format requirements
5. Never include secrets, tokens, passwords, or unnecessary personal data

## Script Commands

All examples use:

```bash
SCRIPT="<SKILL_DIR>/scripts/manus_client.py"
```

### Create task

```bash
uv run "$SCRIPT" create \
  --prompt "Your enriched prompt here" \
  --mode agent \
  --profile manus-1.6 \
  --locale zh-CN
```

Useful optional flags:

- `--attachment /path/to/file` repeatable
- `--connector <uuid>` repeatable
- `--task-id <id>` to continue an existing task
- `--label <text>` to store a local label in the registry

### Check status

```bash
uv run "$SCRIPT" status --task-id <task_id>
```

Use `--convert` when you want Manus to convert PPTX output during retrieval.

### Get result

```bash
uv run "$SCRIPT" result --task-id <task_id>
```

Downloads go to `~/.manus-skill/downloads/YYYYMM/` by default.

### List recent tasks

```bash
uv run "$SCRIPT" list --limit 10 --status completed
```

### Delete task

```bash
uv run "$SCRIPT" delete --task-id <task_id>
```

This maps to Manus `DELETE /v1/tasks/{task_id}`.

## Multi-Turn Tasks

When Manus returns `stop_reason: "ask"`:

1. Relay the question to the user
2. Continue the same task with:

```bash
uv run "$SCRIPT" create \
  --task-id <original_task_id> \
  --prompt "User's follow-up answer"
```

## Cost Awareness

- Default to `manus-1.6`
- Use `manus-1.6-lite` for exploratory or lower-stakes work
- Use `manus-1.6-max` only when the task clearly needs the highest capability

## Files

- Main client: `<SKILL_DIR>/scripts/manus_client.py`
- API notes: `<SKILL_DIR>/references/api.md`
- Setup notes: `<SKILL_DIR>/references/setup.md`
- Optional webhook helper: `<SKILL_DIR>/scripts/webhook-transform.js`
